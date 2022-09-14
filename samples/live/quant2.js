"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");

async function sleep(ms) {
    let promise = new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    await promise;
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
    const exchange = new ccxt.binance({
        'apiKey': 'NHOkdZV92IY0sIcvdfswkc60SCyJAKTnrbgkHILGDHQW6NXGo87NwzQmBXXFGJSo',
        'secret': 'W9ffpThUt5TLVqOJG2tNZeFyAhiDJqyUK3lX3IgRqBTEpcG2SuHRJFLQyvyCTpK0',
        'options': {
            'defaultType': 'future'
        }
    });

    var symbol = "LUNA2/BUSD";

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
    let preStatus = "";
    let maxPrices = [];
    let minPrices = [];
    let buyAmounts = [];
    let sellAmounts = [];
    let prices = [];
    let priceNum = 7;

    while (true) {
        var time = exchange.milliseconds();
        var trades = await exchange.fetchTrades(symbol, time - 3 * 500, 500)
        trades = trades.reverse()
        var buyCount = 0;
        var sellCount = 0;
        var maxPrice = 0;
        var minPrice = 10;
        var lastPrice = 0;
        var buySum = 0;
        var sellSum = 0;
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

        let maxPrePrice = Math.max(...prices);
        let minPrePrice = Math.min(...prices);
        // preBuyPrice = buyPrice;
        // preSellPrice = sellPrice;
        // preBuyRatio = buyRatio;
        // preSellRatio = sellRatio;
        // preMinPrice = minPrice;
        // preMaxPrice = maxPrice;
        // maxPrices.push(maxPrice);
        // minPrices.push(minPrice);
        prices.push(lastPrice)
        buyAmounts.push(buyCount);
        sellAmounts.push(sellCount);

        if (buyAmounts.length > priceNum) {
            // maxPrices = maxPrices.slice(-priceNum);
            // minPrices = minPrices.slice(-priceNum);
            // prices = prices.slice(-priceNum)
            buyAmounts = buyAmounts.slice(-priceNum);
            sellAmounts = sellAmounts.slice(-priceNum);
        }

        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        let longPrice = parseFloat((maxPrice * 0.618 + minPrice * 0.382).toPrecision(pricePresision));
        let shortPrice = parseFloat((maxPrice * 0.382 + minPrice * 0.618).toPrecision(pricePresision));

        let averageBuy = buyAmounts.reduce((a, b) => a + b, 0) / buyAmounts.length;
        let averageSell = sellAmounts.reduce((a, b) => a + b, 0) / sellAmounts.length;
        const orderbook = await exchange.fetchOrderBook(symbol)
        let bidAmount = 0;
        let bidAmountRatio = 0.2;
        let buyPrice = orderbook.bids[0][0];
        for (let i = 0, len = orderbook.bids.length; i < len; i++) {
            let bid = orderbook.bids[i];
            // console.log("bid: %d, amount: %d", bid[0], bid[1]);
            bidAmount += bid[1];
            if (bidAmount > averageSell * bidAmountRatio) {
                break;
            }
            buyPrice = bid[0];
        }
        let askAmount = 0;
        let askAmountRatio = 0.2;
        let sellPrice = orderbook.asks[0][0]
        for (let i = 0, len = orderbook.asks.length; i < len; i++) {
            let ask = orderbook.asks[i];
            askAmount += ask[1];
            if (askAmount > averageBuy * askAmountRatio) {
                break;
            }
            sellPrice = ask[0];
        }

        // 多空分析
        // let buyRatio = buyCount / sellCount;
        // let sellRatio = sellCount / buyCount;

        let status = "none";
        /*
        let ratio = 4;
        if (buyRatio > ratio && preBuyRatio > ratio) {
            status = "long";
        }
        else if (sellRatio > ratio && preSellRatio > ratio) {
            status = "short";
        }
        let maxMax = Math.max(...maxPrices);
        let minMax = Math.min(...maxPrices);
        let minMin = Math.min(...minPrices);
        let maxMin = Math.max(...minPrices);
        let maxPrePrice = Math.max(...prices);
        let minPrePrice = Math.min(...prices);
        */
        if (buyPrice >= longPrice) {
            status = "up";
            // 顶部位置，涨不动了
            // if (maxPrice >= minMax && maxPrice <= maxMax || minPrice <= maxMin && minPrice >= minMin) {
            //     status = "down";
            // }
        }
        else if (sellPrice <= shortPrice) {
            status = "down";
            // 底部位置，跌不动了
            // if (minPrice >= minMin && minPrice <= maxMin || maxPrice >= minMax && maxPrice <= maxMax) {
            //     status = "up";            
            // }
        }
        logger.log('buy sum: %d, sell sum: %d, buy price: %d, sell price: %d, max: %d, min: %d, status: %s, last price: %d', buySum, sellSum, averageBuyPrice, averageSellPrice, maxPrice, minPrice, status, lastPrice);
        logger.log('buy amount: %d, sell amount: %d, bid price: %d, ask price: %d', buyCount, sellCount, buyPrice, sellPrice);
       
        await sleep(100);
        continue;
        // 执行订单
        // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
        let positionAmt = await broker.getPosition();
        let trading = false;
        if (positionAmt > 0) {
            let price = status != "down" && preStatus == "up" ? sellPrice : minPrice
            trading = await broker.sell(price, positionAmt, 500);
        }
        else if (positionAmt < 0) {
            let price = status != "up" && preStatus == "down" ? buyPrice : maxPrice
            trading = await broker.buy(price, -positionAmt, 500);
        }
        else if (sellPrice > buyPrice * 1.0008){
            let size = 5;
            if (status == "up") {
                let price = Math.max(buyPrice, maxPrice);
                if (sellPrice > price * 1.0008) {
                    trading = await broker.buy(price, size, 500);
                    if (trading) {
                        trading = await broker.sell(sellPrice, size, 1000);
                    }
                }
            }
            else if (status == "down") {
                let price = Math.min(minPrice, sellPrice)
                if (buyPrice < price * 0.9992) {
                    trading = await broker.sell(price, size, 500);
                    if (trading) {
                        trading = await broker.buy(buyPrice, size, 1000);
                    }
                }
            }
        }
        if (!trading) {
            await sleep(100);
        }
        preStatus = status;
    }

})()