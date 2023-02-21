"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");
// const HttpsProxyAgent = require('https-proxy-agent');
// const socks = require('@luminati-io/socksv5')

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

    async buy(price, size, waitTime) {
        return this.submit(price, size, "buy", waitTime);
    }

    async sell(price, size, waitTime) {
        return this.submit(price, size, "sell", waitTime);
    }

    async submit(price, size, side, waitTime) {
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
        if (order.status == "open") {
            let canceled = await this.cancelOrder(orderId);
            return !canceled
        }
        return order.status == "closed";
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

    // const agent = new socks.HttpsAgent({
    //     proxyHost: 'ss.succez.com',
    //     proxyPort: 1086,
    //     auths: [socks.auth.None()]
    // })

    const exchange = new ccxt.binance({
        'apiKey': 'NHOkdZV92IY0sIcvdfswkc60SCyJAKTnrbgkHILGDHQW6NXGo87NwzQmBXXFGJSo',
        'secret': 'W9ffpThUt5TLVqOJG2tNZeFyAhiDJqyUK3lX3IgRqBTEpcG2SuHRJFLQyvyCTpK0',
        //    'agent': httpsAgent,
        'options': {
            'defaultType': 'future'
        }
    });

    var symbol = "APT/USDT";

    let markets = await exchange.loadMarkets();
    let broker = new MyBroker(exchange, symbol);
    let market = markets[symbol];
    let amountMin = parseFloat(market.limits.amount.min);
    let amountPrecision = parseInt(market.precision.amount);
    let priceMin = parseFloat(market.limits.price.min);
    let pricePresision = parseInt(market.precision.price) + 1;

    let priceGrain = Math.pow(10, 0 - pricePresision);
    let preTime = 0;
    let status = "none";
    var buyCount = 0;
    var sellCount = 0;
    var preMaxPrice = 0;
    var preMinPrice = 0;
    var maxPrice = 0;
    var minPrice = 100000;
    let averageBuyPrice = buySum / buyCount;
    let averageSellPrice = sellSum / sellCount;

    while (true) {
        var startTime = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, startTime - 3 * 1000, 100)
        preTime = startTime;
        buyCount = 0;
        sellCount = 0;
        maxPrice = 0;
        minPrice = 100000;
        var lastPrice = 0;
        var buySum = 0;
        var sellSum = 0;

        for (let i = 0, len = trades.length; i < len; i++) {
            let trade = trades[i];
            lastPrice = trade.price;
            if (trade.side == 'buy') {
                buyCount += trade.amount;
                buySum += lastPrice * trade.amount;
            }
            else {
                sellCount += trade.amount;
                sellSum += lastPrice * trade.amount;
            }
            maxPrice = Math.max(maxPrice, lastPrice);
            minPrice = Math.min(minPrice, lastPrice)
        }
        averageBuyPrice = buySum / buyCount;
        averageSellPrice = sellSum / sellCount;

        // 多空分析
        // const orderbook = await exchange.fetchOrderBook(symbol)
        status = "none";
        let sum = sellSum + buySum;
        if (preMaxPrice == 0) {

        }
        else if (buySum > sum * 0.618) {
            status = "up";
        }
        else if (sellSum > sum * 0.618) {
            status = "down";
        }

        logger.log('buy sum: %d, sell sum: %d, buy average: %d, sell average: %d, max: %d, min: %d, status: %s', buySum, sellSum, averageBuyPrice, averageSellPrice, maxPrice, minPrice, status);

        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        // const orderbook = await exchange.fetchOrderBook(symbol, 50);

        // let bid1 = orderbook.bids[0][0]
        // let ask1 = orderbook.asks[0][0]

        let buyPrice = minPrice - preMinPrice + minPrice;
        let sellPrice = maxPrice - preMaxPrice + maxPrice;

        // 执行订单
        // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
        let positionAmt = await broker.getPosition();
        let trading = false;
        if (positionAmt > 0) {
            let price = sellPrice
            trading = await broker.sell(price, positionAmt, 500);
        }
        else if (positionAmt < 0) {
            let price = buyPrice
            trading = await broker.buy(price, -positionAmt, 500);
        }
        else {
            let size = 0.8;
            if (status == "up") {
                if (sellPrice > buyPrice * 1.0008) {
                    trading = await broker.buy(buyPrice, size, 500);
                    if (trading) {
                        trading = await broker.sell(sellPrice, size, 500);
                    }
                }
            }
            else if (status == "down") {
                if (buyPrice < sellPrice * 0.9992) {
                    trading = await broker.sell(sellPrice, size, 500);
                    if (trading) {
                        trading = await broker.buy(buyPrice, size, 500);
                    }
                }
            }
        }
        logger.log("bid price: %d, ask price: %d", buyPrice, sellPrice);
        if (!trading) {
            await sleep(100);
        }
        preMaxPrice = maxPrice;
        preMinPrice = minPrice;
    }

})()