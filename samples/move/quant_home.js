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

class MyTrader {

    constructor() {
        this.maxPrice = 0;
        this.minPrice = 0;
        this.lastPrice = 0;
        this.status = "none"
        this.shape = "none";
        this.buyAmount = 0;
        this.sellAmount = 0;
    }

    getBuyAmount() {
        return this.buyAmount;
    }

    getSellAmount() {
        return this.sellAmount;
    }

    getAmount() {
        return this.buyAmount + this.sellAmount;
    }

    getStatus() {
        return this.status;
    }

    getShape() {
        return this.shape;
    }

    addTrades(trades) {
        var buySum = 0;
        var sellSum = 0;
        var buyCount = 0;
        var sellCount = 0;
        var maxPrice = 0;
        var minPrice = 1000000;
        var lastPrice = 0;
        var status = "none";
        var shape = "none";
        for (let i = 0, len = trades.length; i < len; i++) {
            let trade = trades[i];
            if (trade.side == 'buy') {
                buyCount += trade.amount;
                buySum += trade.price * trade.amount;
            }
            else {
                sellCount += trade.amount;
                sellSum += trade.price * trade.amount;
            }
            lastPrice = trade.price;
            maxPrice = Math.max(maxPrice, lastPrice);
            minPrice = Math.min(minPrice, lastPrice)
        }
        let averageBuyPrice = buySum / buyCount;
        let averageSellPrice = sellSum / sellCount;

        if (averageBuyPrice > averageSellPrice) {
            if (lastPrice < averageSellPrice) {
                status = "down";
                shape = 'bsl';
            }
            else if (lastPrice > averageBuyPrice) {
                status = 'up';
                shape = 'lbs';
            }
            else {
                if (averageBuyPrice - lastPrice > lastPrice - averageSellPrice) {
                    status = 'up';
                    shape = 'bls'
                }
                else {
                    status = 'down';
                    shape = 'bls';
                }
            }
        }
        else if (averageBuyPrice < averageSellPrice) {
            if (lastPrice > averageSellPrice) {
                status = "down";
                shape = 'lsb';
            }
            else if (lastPrice < averageBuyPrice) {
                status = 'up';
                shape = 'sbl';
            }
            else {
                if (averageSellPrice - lastPrice > lastPrice - averageBuyPrice) {
                    status = 'up';
                    shape = 'slb'
                }
                else {
                    status = 'down';
                    shape = 'slb'
                }
            }
        }
        this.status = status;
        this.shape = shape;
        this.buyAmount = buyCount;
        this.sellAmount = sellCount;
        logger.log('buy sum: %d, sell sum: %d, buy price: %d, sell price: %d, max: %d, min: %d, status: %s, last price: %d', buySum, sellSum, averageBuyPrice, averageSellPrice, maxPrice, minPrice, status, lastPrice);
        logger.log('buy amount: %d, sell amount: %d', buyCount, sellCount);
    }
}

class MyBroker {

    constructor(exchange, symbol) {
        this.exchange = exchange;
        this.symbol = symbol;
    }

    async buy(price, size, waitTime, cancel, params) {
        return this.submit(price, size, "buy", waitTime, cancel);
    }

    async sell(price, size, waitTime, cancel, params) {
        return this.submit(price, size, "sell", waitTime, cancel);
    }

    async submit(price, size, side, waitTime, cancel, params) {
        let exchange = this.exchange;
        let symbol = this.symbol;
        logger.log("side: %s, price: %d, size: %d", side, price, size);

        let order = await exchange.createLimitOrder(symbol, side, size, price, params);
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
                    canceled = true;
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
        'apiKey': 'mRPdVN9i0bGptAJgshI5G35pabcL56A4ZmMyImBqeiLhdchHuplynlXAopB9ujUK',
        'secret': 'gtcV6zAL4OHGyzr7ZFysyAhxkpTGqOuJpvQ82dca3bfdWKmVkGUNiBsohLrE2flS',
        'options': {
            'defaultType': 'future'
        },
        // "agent": httpsAgent
    });

    var symbol = "APT/USDT";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let amountMin = parseFloat(market.limits.amount.min);
    let amountPrecision = parseInt(market.precision.amount);
    let priceMin = parseFloat(market.limits.price.min);
    let pricePresision = parseInt(market.precision.price);

    let broker = new MyBroker(exchange, symbol);
    let trader = new MyTrader();

    let priceGrain = Math.pow(10, 0 - pricePresision);
    let preStatus = "";
    let prices = [];
    let preTime = 0;
    let orderId = null;

    while (true) {
        var time = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, time - 1 * 1000, 1000);
        trader.addTrades(trades);
        let status = trader.getStatus();
        let amount = trader.getAmount();

        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        const orderbook = await exchange.fetchOrderBook(symbol, 50);
        let bestBid = getBestBidPrice(orderbook.bids, amount);
        let bestAsk = getBestAskPrice(orderbook.asks, amount);
        let bid1 = orderbook.bids[0][0]
        let ask1 = orderbook.asks[0][0]

        let bidPrice = bestBid + priceGrain
        let askPrice = bestAsk - priceGrain
        logger.log("bid price: %d, ask price: %d", bidPrice, askPrice);

        if (orderId) {
            await broker.cancelOrder(orderId);
            orderId = null;
        }
        // 执行订单
        // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
        let positionAmt = await broker.getPosition();
        let trading = false;
        if (positionAmt > 0) {
            let price = askPrice;
            let order = await broker.sell(price, positionAmt, 500, false, { "reduceOnly": true });
            if (order.status == "open") {
                orderId = order.orderId;
            }
            trading = true;
        }
        else if (positionAmt < 0) {
            let price = bidPrice;
            let order = await broker.buy(price, -positionAmt, 500, false, { "reduceOnly": true });
            if (order.status == "open") {
                orderId = order.orderId;
            }
            trading = true;
        }
        else if (askPrice > bidPrice * 1.001) {
            let size = 0.8;
            if (status == "up") {
                let order = await broker.buy(bidPrice, size, 500, true);
                if (order.status == 'closed') {
                    order = await broker.sell(askPrice, size, 500, false);
                    if (order.status == "open") {
                        orderId = order.orderId;
                    }
                }
                trading = true;
            }
            else if (status == "down") {
                let order = await broker.sell(askPrice, size, 500, true);
                if (order.status == 'closed') {
                    order = await broker.buy(bidPrice, size, 500, false);
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