"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");
// const HttpsProxyAgent = require('https-proxy-agent');

async function sleep(ms) {
    let promise = new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    await promise;
}

function getBestBidPrice(bids, amount) {
    let bidAmount = 0;
    let bidPrice = bids[0][0];
    for (let i = 0, len = bids.length; i < len; i++) {
        let bid = bids[i];
        bidAmount += bid[1];
        if (bidAmount > amount) {
            break;
        }
        bidPrice = bid[0];
    }
    return bidPrice;
}

function getBestAskPrice(asks, amount) {
    let askAmount = 0;
    let askPrice = asks[0][0];
    for (let i = 0, len = asks.length; i < len; i++) {
        let bid = asks[i];
        askAmount += bid[1];
        if (askAmount > amount) {
            break;
        }
        askPrice = bid[0];
    }
    return askPrice;
}

class MyLogger {

    constructor(logFile) {
        this.log_file = fs.createWriteStream(logFile, { flags: 'w' });
    }

    log() {
        let date = new Date();
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        let log = '[' + date.toISOString() + '] ' + util.format.apply(null, arguments);
        this.log_file.write(log + '\n');
        console.log(log);
    }
}

let logger = new MyLogger('quant.log');

class MyBroker {

    constructor(exchange, symbol) {
        this.exchange = exchange;
        this.symbol = symbol;
    }

    async buy(price, size, waitTime, cancel) {
        return this.submit(price, size, "buy", waitTime, cancel);
    }

    async sell(price, size, waitTime, cancel) {
        return this.submit(price, size, "sell", waitTime, cancel);
    }

    async submit(price, size, side, waitTime, cancel) {
        let exchange = this.exchange;
        let symbol = this.symbol;
        logger.log("side: %s, price: %d, size: %d", side, price, size);

        let order = await exchange.createLimitOrder(symbol, side, size, price);
        let orderId = order.id;
        let time = 0;
        while (time < waitTime) {
            order = await exchange.fetchOrder(orderId, symbol);
            if (order.status == "closed") {
                logger.log("closed: %s", orderId);

                break;
            }
            time += 150;
            await sleep(150);
        }
        let status = order.status;
        if (status == 'open' && cancel) {
            let canceled = await this.cancelOrder(orderId);
            status = canceled ? "canceled" : "closed";
        }
        return {
            orderId: orderId,
            status: status
        };
    }

    async cancelOrder(orderId) {
        logger.log("cancel: %s", orderId);

        let canceled = false;
        while (true) {
            try {
                await this.exchange.cancelOrder(orderId, this.symbol);
                canceled = true;
                break;
            }
            catch (e) {
                if (e instanceof ccxt.OrderNotFound) {
                    logger.log("cancel fail, order executed: %s", orderId);
                    canceled = false;
                    break;
                }
                logger.log("error: %s", e);
                sleep(100);
            }
        }
        return canceled;
    }

    async getPosition() {
        let postions = await this.exchange.fetch_positions([this.symbol]);
        let info = postions[0].info;
        return parseFloat(info.positionAmt);
    }
}

; (async () => {
    // const httpsAgent = new HttpsProxyAgent("http://127.0.0.1:7890");
    const exchange = new ccxt.binance({
        'apiKey': 'NHOkdZV92IY0sIcvdfswkc60SCyJAKTnrbgkHILGDHQW6NXGo87NwzQmBXXFGJSo',
        'secret': 'W9ffpThUt5TLVqOJG2tNZeFyAhiDJqyUK3lX3IgRqBTEpcG2SuHRJFLQyvyCTpK0',
        'options': {
            'defaultType': 'future'
        },
        // "agent": httpsAgent
    });

    var symbol = "LUNA2/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let pricePresision = parseInt(market.precision.price) + 1;
    
    let broker = new MyBroker(exchange, symbol);

    let priceGrain = Math.pow(10, 0 - pricePresision);
    let pnl = 0.00005;
    let orderId = null;

    while (true) {
        let prices = []
        var time = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, time - 2*1000, 100);
        let len = trades.length;
        if (len < 8) {
            continue;
        } 
        for (var i = 0; i < 8; i++) {
            prices[i] = trades[len - 8 + i].price;
        }
        let maxPrice = 0;
        let minPrice = 100000;
        let amount = 0;
        for (let i =0; i < len; i++) {
            let trade = trades[i];
            maxPrice = Math.max(trade.price, maxPrice);
            minPrice = Math.min(trade.price, minPrice);
            amount += trade.amount;
        }

        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        const orderbook = await exchange.fetchOrderBook(symbol, 50);
        let bestBid = getBestBidPrice(orderbook.bids, amount/2);
        let bestAsk = getBestAskPrice(orderbook.asks, amount/2);
        let bid1 = orderbook.bids[0][0]
        let ask1 = orderbook.asks[0][0]

        let bidPrice = bestBid * 0.618 + bestAsk * 0.382 + priceGrain
        let askPrice = bestBid * 0.382 + bestAsk * 0.618 - priceGrain
        let lastPrice = parseFloat(((orderbook.bids[0][0] + orderbook.asks[0][0]) * 0.35 +
            (orderbook.bids[1][0] + orderbook.asks[1][0]) * 0.1 +
            (orderbook.bids[2][0] + orderbook.asks[2][0]) * 0.05).toPrecision(pricePresision));

        var status = "none";
        var burstPrice = lastPrice * pnl
        if (lastPrice - Math.max(...prices.slice(-6)) > burstPrice ||
            lastPrice - Math.max(...prices.slice(-6, -1)) > burstPrice && lastPrice > prices[prices.length - 1]) {
            status = "up";
        }
        else if (lastPrice - Math.min(...prices.slice(-6)) < -burstPrice ||
            lastPrice - Math.min(...prices.slice(-6, -1)) < -burstPrice && lastPrice < prices[prices.length - 1]) {
            status = "down";
        }
        logger.log("status: %s, bidPrice: %d, askPrice: %d, amount: %d, lastPrice: %d", status, bidPrice, askPrice, amount, lastPrice);
    
        if (orderId) {
            await broker.cancelOrder(orderId);
            orderId = null;
        }
        // 执行订单
        // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
        let positionAmt = await broker.getPosition();
        let trading = false;
        if (positionAmt > 0) {
            let price = status == 'up' ? askPrice : ask1;
            let order = await broker.sell(price, positionAmt, 500, false);
            if (order.status == "open") {
                orderId = order.orderId;
            }
            trading = true;
        }
        else if (positionAmt < 0) {
            let price = status == "down" ? bidPrice : bid1;
            let order = await broker.buy(price, -positionAmt, 500, false);
            if (order.status == "open") {
                orderId = order.orderId;
            }
            trading = true;
        }
        else {
            let size = 2;
            if (status == "up") {
                let order = await broker.buy(bidPrice, size, 500, true);
                if (order.status == 'closed') {
                    order = await broker.sell(bidPrice*1.0008, size, 500, false);
                    if (order.status == "open") {
                        orderId = order.orderId;
                    }
                }
                trading = true;
            }
            else if (status == "down") {
                let order = await broker.sell(askPrice, size, 500, true);
                if (order.status == 'closed') {
                    order = await broker.buy(askPrice*0.9992, size, 500, false);
                    if (order.status == "open") {
                        orderId = order.orderId;
                    }
                }
                trading = true;
            }
        }
        if (!trading && positionAmt == 0) {
            await sleep(100);
        }
    }

})()