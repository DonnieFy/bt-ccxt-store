"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");
const HttpsProxyAgent = require('https-proxy-agent');
const socks = require('@luminati-io/socksv5')

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

    let preBuyPrice = 0;
    let preSellPrice = 0;
    let preBuyRatio = 0;
    let preSellRatio = 0;
    let preMaxPrice = 0;
    let preMinPrice = 0;

    while (true) {
        var time = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, time - 5 * 1000, 1000)
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
            // sum += trade.price * trade.amount;
            maxPrice = Math.max(maxPrice, trade.price);
            minPrice = Math.min(minPrice, trade.price)
        }

        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        let buyPrice = parseFloat((maxPrice * 0.382 + minPrice * 0.618).toPrecision(pricePresision));
        let sellPrice = parseFloat((maxPrice * 0.618 + minPrice * 0.382).toPrecision(pricePresision));

       // 多空分析
        let buyRatio = buyCount / sellCount;
        let sellRatio = sellCount/ buyCount;

        let status = "none";
        if (buyRatio > 2 && preBuyRatio > 2) {
            status = "long";
        }
        else if (sellRatio > 2 && preSellRatio > 2) {
            status = "short";
        }
        else if (maxPrice >= preMaxPrice && minPrice >= preMinPrice) {
            status = "up";
        }
        else if (maxPrice <= preMaxPrice && minPrice <= preMinPrice) {
            status = "down";
        }
        logger.log('buy amount: %d, sell amount: %d, buy price: %d, sell price: %d, max: %d, min: %d, status: %s', buyCount, sellCount, buyPrice, sellPrice, maxPrice, minPrice, status);
       
        preBuyPrice = buyPrice;
        preSellPrice = sellPrice;
        preBuyRatio = buyRatio;
        preSellRatio = sellRatio;
        preMinPrice = minPrice;
        preMaxPrice = maxPrice;

        // 执行订单
        // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
        let positionAmt = await broker.getPosition();
        let trading = false;
        if (positionAmt > 0) {
            if (status != "long" && status != "up") {
                trading = await broker.sell(sellPrice, positionAmt, 1500);
            }
        }
        else if (positionAmt < 0) {
            if (status != "short" && status != "down") {
                trading = await broker.buy(buyPrice, -positionAmt, 1500);
            }
        }
        else {
            let size = 200;
            let aggressive = maxPrice > minPrice * 1.003;

            if (status == "long") {
                let extra = (buyRatio.toPrecision(1)) * priceGrain;
                let price = aggressive ? maxPrice : Math.min(maxPrice, buyPrice + extra);
                trading = await broker.buy(price, size, 1500);
            }
            else if (status == "short") {
                let extra = (sellRatio.toPrecision(1)) * priceGrain;
                let price = aggressive ? minPrice : Math.max(minPrice, sellPrice - extra);
                trading = await broker.sell(price, size, 1500);
            }
        }
        if (!trading) {
            await sleep(1000);
        }
    }

})()