"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const HttpsProxyAgent = require('https-proxy-agent');
const socks = require('@luminati-io/socksv5')

async function sleep(ms) {
    let promise = new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    await promise;
}

class MyBroker {

    constructor(exchange, symbol) {
        this.exchange = exchange;
        this.symbol = symbol;
        this.position = 0;
    }

    async buy(price, size) {
        return this.submit(price, size, "buy");
    }

    async sell(price, size) {
        return this.submit(price, size, "sell");
    }

    async submit(price, size, side) {
        let exchange = this.exchange;
        let symbol = this.symbol;
        console.log("side: %s, price: %d, size: %d", side, price, size);
        let order = await exchange.createLimitOrder(symbol, side, size, price);
        let orderId = order.id;
        let waitTime = 0;
        while (waitTime < 300) {
            await sleep(100);
            order = await exchange.fetchOrder(orderId, symbol);
            if (order.status == "closed") {
                console.log("closed: %s", orderId);
                this.position += (side == "buy" ? size : 0-size);
                break;
            }
            waitTime += 100;
        }
        if (order.status == "open") {
           await this.cancelOrder(orderId, side);
        }
    }

    async cancelOrder(orderId, side) {
        console.log("cancel: %s", orderId);
        while (true) {
            try {
                await this.exchange.cancelOrder(orderId, this.symbol);
                break;
            }
            catch(e) {
                if (e instanceof ccxt.OrderNotFound) {
                    console.log("cancel fail, order executed: %s", orderId);
                    this.position += (side == "buy" ? size : 0-size);
                    break;
                }
                console.log("error: %s", e);
                sleep(100);
            }
        }
    }

    async getPosition() {
        // let postions = await this.exchange.fetch_positions([this.symbol]);
        // let info = postions[0].info;
        // return parseFloat(info.positionAmt);
        return this.position;
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
        'agent': agent,
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

    while (true) {
        var time = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, time - 5 * 1000, 1000)
        trades = trades.reverse()
        var buyCount = 0;
        var sellCount = 0;
        var maxPrice = 0;
        var minPrice = 10;
        for (let i = 0, len = trades.length; i < len; i++) {
            let trade = trades[i];
            if (trade.side == 'buy') {
                buyCount += trade.amount;
            }
            else {
                sellCount += trade.amount;
            }
            maxPrice = Math.max(maxPrice, trade.price);
            minPrice = Math.min(minPrice, trade.price)
            // let date = new Date(trade.timestamp);
            // date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
            // console.log("time: %s, side: %s, price: %d, amount: %d, cost: %d, takerOrMaker: %s", date.toISOString(), trade.side, trade.price, trade.amount, trade.cost, trade.takerOrMaker)
        }

        let buyPrice = parseFloat((maxPrice * 0.382 + minPrice * 0.618).toPrecision(pricePresision));
        let sellPrice = parseFloat((maxPrice * 0.618 + minPrice * 0.382).toPrecision(pricePresision));

        // 已经有仓位了，优先退出
        let positionAmt = await broker.getPosition();
        if (positionAmt > 0) {
            await broker.sell(sellPrice, positionAmt);
            // 不管是否退出，开始下个循环
            continue;
        }
        else if (positionAmt < 0) {
            await broker.buy(sellPrice, -positionAmt);
            continue;
        }

        var status = "none";
        if (buyCount > sellCount * 1.8 && sellPrice > buyPrice * 1.0008) {
            status = "long";
            sellPrice += sellPrice - buyPrice
        }
        else if (sellCount > buyCount * 1.8 && buyPrice < sellPrice * 0.9992) {
            status = "short";
            buyPrice -= sellPrice - buyPrice
        }
        if (status == "none") {
            await sleep(1000);
            console.log('no signal, wait 1000ms');
            console.log('buy amount: %d, sell amount: %d, buy price: %d, sell price: %d, max: %d, min: %d', buyCount, sellCount, buyPrice, sellPrice, maxPrice, minPrice);
            continue;
        }
        let size = 10;
        if (status == "long") {
            await broker.buy(buyPrice, size);
            let positionAmt = await broker.getPosition();
            if (positionAmt > 0) {
                await broker.sell(sellPrice, size);
            }
        }
        else {
            await broker.sell(sellPrice, size);
            let positionAmt = await broker.getPosition();
            if (positionAmt < 0) {
                await broker.buy(buyPrice, size);
            }
        }
    }

})()