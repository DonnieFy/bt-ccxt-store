"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");
const HttpsProxyAgent = require('https-proxy-agent');
const socks = require('@luminati-io/socksv5')
require('log-timestamp');   

async function sleep(ms) {
    let promise = new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    await promise;
}

class MyLogger {

    constructor(logFile) {
        this.log_file = fs.createWriteStream(logFile, {flags : 'w'});
    }

    log() {
        let log = util.format.apply(null, arguments);
        this.log_file.write(log + '\n');
        console.log(log);
    }
}

let logger = new MyLogger('./quant.log');

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
            time += 200;
            await sleep(200);
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
            catch(e) {
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
    const httpsAgent = new HttpsProxyAgent("http://127.0.0.1:7890");

    const agent = new socks.HttpsAgent({
        proxyHost: 'ss.succez.com',
        proxyPort: 1086,
        auths: [socks.auth.None()]
    })

    const exchange = new ccxt.binance({
        'apiKey': 'NHOkdZV92IY0sIcvdfswkc60SCyJAKTnrbgkHILGDHQW6NXGo87NwzQmBXXFGJSo',
        'secret': 'W9ffpThUt5TLVqOJG2tNZeFyAhiDJqyUK3lX3IgRqBTEpcG2SuHRJFLQyvyCTpK0',
        'agent': httpsAgent,
        'options': {
            'defaultType': 'future'
        }
    });

    var symbol = "1000LUNC/BUSD";

    let markets = await exchange.loadMarkets();
    let broker = new MyBroker(exchange, symbol);
    let market = markets[symbol];
    let amountMin = parseFloat(market.limits.amount.min);
    let amountPrecision = parseInt(market.precision.amount);
    let priceMin = parseFloat(market.limits.price.min);
    let pricePresision = parseInt(market.precision.price);

    let priceGrain = Math.pow(10, 0 - pricePresision);

    while (true) {
        var time = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, time - 3 * 1000, 1000)
        trades = trades.reverse()
        var buyCount = 0;
        var sellCount = 0;
        var maxPrice = 0;
        var minPrice = 10;
        var sum = 0;
        for (let i = 0, len = trades.length; i < len; i++) {
            let trade = trades[i];
            if (trade.side == 'buy') {
                buyCount += trade.amount;
            }
            else {
                sellCount += trade.amount;
            }
            sum += trade.price * trade.amount;
            maxPrice = Math.max(maxPrice, trade.price);
            minPrice = Math.min(minPrice, trade.price)
            // let date = new Date(trade.timestamp);
            // date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
            // logger.log("time: %s, side: %s, price: %d, amount: %d, cost: %d, takerOrMaker: %s", date.toISOString(), trade.side, trade.price, trade.amount, trade.cost, trade.takerOrMaker)
        }

        let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        let buyPrice = parseFloat((maxPrice * 0.382 + minPrice * 0.618).toPrecision(pricePresision));
        let sellPrice = parseFloat((maxPrice * 0.618 + minPrice * 0.382).toPrecision(pricePresision));

        // 已经有仓位了，优先退出
        let positionAmt = await broker.getPosition();
        if (positionAmt > 0) {
            await broker.sell(sellPrice, positionAmt, 1500);
            // 不管是否退出，开始下个循环
            continue;
        }
        else if (positionAmt < 0) {
            await broker.buy(sellPrice, -positionAmt, 1500);
            continue;
        }

        let status = "none";
        let diff = maxPrice - minPrice
        if (buyCount > sellCount * 2 && sellPrice > buyPrice * 1.001) {
            status = "long";
            buyPrice += priceGrain;
            sellPrice = maxPrice - priceGrain;
        }
        else if (sellCount > buyCount * 2 && buyPrice < sellPrice * 0.999) {
            status = "short";
            sellPrice -= priceGrain;
            buyPrice = minPrice + priceGrain;
        }
        logger.log('buy amount: %d, sell amount: %d, buy price: %d, sell price: %d, max: %d, min: %d, status: %s', buyCount, sellCount, buyPrice, sellPrice, maxPrice, minPrice, status);
        if (status == "none") {
            await sleep(1000);
            // logger.log('no signal, wait 1000ms');
            continue;
        }
        let size = 200;
        let trading = true;
        while (trading) {
            if (status == "long") {
                trading = await broker.buy(buyPrice, size, 2000);
                let positionAmt = await broker.getPosition();
                if (positionAmt > 0) {
                    trading = await broker.sell(sellPrice, size, 3000);
                }
            }
            else {
                trading = await broker.sell(sellPrice, size, 2000);
                let positionAmt = await broker.getPosition();
                if (positionAmt < 0) {
                    trading = await broker.buy(buyPrice, size, 3000);
                }
            }
        }
    }

})()