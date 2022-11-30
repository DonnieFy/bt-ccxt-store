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

class MyLogger {

    constructor(logFile) {
        this.log_file = fs.createWriteStream(logFile, { flags: 'w' });
    }

    log() {
        let date = new Date();
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        let log = util.format.apply(null, arguments);
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

    async buy(price, size, waitTime, cancel, reduceOnly) {
        return this.submit(price, size, "buy", waitTime, cancel, reduceOnly);
    }

    async sell(price, size, waitTime, cancel, reduceOnly) {
        return this.submit(price, size, "sell", waitTime, cancel, reduceOnly);
    }

    async submit(price, size, side, waitTime, cancel, reduceOnly) {
        let exchange = this.exchange;
        let symbol = this.symbol;
        logger.log("side: %s, price: %d, size: %d", side, price, size);

        let params = reduceOnly ? { "reduceOnly": true } : null;
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
        let canceled = false;
        while (true) {
            try {
                await this.exchange.cancelOrder(orderId, this.symbol);
                canceled = true;
                break;
            }
            catch (e) {
                if (e instanceof ccxt.OrderNotFound) {
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
        'apiKey': 'mRPdVN9i0bGptAJgshI5G35pabcL56A4ZmMyImBqeiLhdchHuplynlXAopB9ujUK',
        'secret': 'gtcV6zAL4OHGyzr7ZFysyAhxkpTGqOuJpvQ82dca3bfdWKmVkGUNiBsohLrE2flS',
        'options': {
            'defaultType': 'future'
        },
        // "agent": httpsAgent
    });

    var symbol = "ETH/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let pricePresision = parseInt(market.precision.price);

    let broker = new MyBroker(exchange, symbol);

    let priceGrain = parseFloat(Math.pow(10, 0 - pricePresision).toPrecision(pricePresision));

    let winTimes = 0;
    let loseTimes = 0;
    let stopTimes = 0;
    let hasError = false;

    let overBuy = false;
    let overSell = false;
    let amount = 0;
    let bidPrices = []
    let askPrices = []

    exchange.myClose = async function () {
        let positionAmt = await broker.getPosition();
        if (positionAmt != 0) {
            if (positionAmt > 0) {
                await exchange.createMarketSellOrder(symbol, positionAmt, { "reduceOnly": true })
            }
            else {
                await exchange.createMarketBuyOrder(symbol, -positionAmt, { "reduceOnly": true })
            }
            logger.log('win: %d, lose: %d, stop: %d, total: %d', winTimes, ++loseTimes, stopTimes, winTimes + loseTimes + stopTimes);
        }
    }

    let period = 8 * 1000;
    let orderbook = null;
    let orderbookPre = null;
    let num = 0;
    let preLayerBid = 0;
    let preLayerAsk = 0;
    let position = 0;

    logger.log('num, amount, buyAmount, sellAmount, buySum, sellSum, startPrice, endPrice, buyMaxPrice, buyMinPrice, sellMaxPrice, sellMinPrice, maxPrice, minPrice, bestBidDepth, bestAskDepth')

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            let time = exchange.milliseconds();
            let orderbook = await exchange.fetchOrderBook(symbol, 500);
            while (exchange.milliseconds() - time < period) {
                await sleep(100);
            }
            let trades = await exchange.fetchTrades(symbol, time - period, 1000)
            let buyAmount = 0;
            let sellAmount = 0;
            let startPrice = trades[0].price;
            let endPrice = trades[trades.length - 1].price;
            let buySum = 0;
            let sellSum = 0;
            let buyMaxPrice = 0;
            let buyMinPrice = 1000000;
            let sellMaxPrice = 0;
            let sellMinPrice = 1000000;
            let maxPrice = 0;
            let minPrice = 1000000;
            for (let i = 0, len = trades.length; i < len; i++) {
                let trade = trades[i];
                let price = trade.price;
                // 收集成交量和速度和
                if (trade.side == 'buy') {
                    buyAmount += trade.amount;
                    buySum += trade.amount * price;
                    buyMaxPrice = Math.max(buyMaxPrice, price);
                    buyMinPrice = Math.min(buyMinPrice, price);
                }
                else {
                    sellAmount += trade.amount;
                    sellSum += trade.amount * price;
                    sellMaxPrice = Math.max(sellMaxPrice, price);
                    sellMinPrice = Math.min(sellMinPrice, price);
                }
                maxPrice = Math.max(maxPrice, price);
                minPrice = Math.min(minPrice, price);
            }
            amount = buyAmount + sellAmount;

            let bestBidDepth = 0;
            let bids = orderbook.bids;
            for (let i = 0, len = bids.length; i < len; i++) {
                let bid = bids[i];
                if (bid[0] < sellMinPrice) {
                    break;
                }
                bestBidDepth += bid[1];
            }
            let bestAskDepth = 0;
            let asks = orderbook.asks;
            for (let i = 0, len = asks.length; i < len; i++) {
                let ask = asks[i];
                if (ask[0] > buyMaxPrice) {
                    break;
                }
                bestAskDepth += ask[1];
            }

            logger.log('%d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d', 
                num++, amount, buyAmount, sellAmount, buySum, sellSum, startPrice, endPrice, buyMaxPrice, buyMinPrice, sellMaxPrice, sellMinPrice, maxPrice, minPrice, bestBidDepth, bestAskDepth);

            
        }
        catch (e) {
            logger.log("error: %s", e);
        }
    }

})()