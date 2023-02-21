"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");
// const HttpsProxyAgent = require('https-proxy-agent');

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
        let time = exchange.milliseconds();
        while (exchange.milliseconds() - time < waitTime) {
            order = await exchange.fetchOrder(orderId, symbol);
            if (order.status == "closed") {
                logger.log("closed: %s", orderId);
                break;
            }
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

    var symbol = "APT/USDT";

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
        }
    }
    exchange.forceCancelAllOrders = async function () {
        try {
            await exchange.cancelAllOrders()
        }
        catch (e) {

        }
    }

    let period = 5 * 1000;
    let num = 0;

    let preBuyMaxPrice = 0;
    let preSellMinPrice = 0;
    let preDiff = 0;

    logger.log('num, amount, buyAmount, sellAmount, buySum, sellSum, startPrice, endPrice, buyMaxPrice, buyMinPrice, sellMaxPrice, sellMinPrice, maxPrice, minPrice, diff, pct')

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            let time = exchange.milliseconds();
            let trades = await exchange.fetchTrades(symbol, time - period, 1000)
            if (trades.length == 0) {
                await sleep(period);
                continue;
            }

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

            let diff = buyMaxPrice - sellMinPrice;

            if (buyMaxPrice >= sellMinPrice * 1.0012 && preBuyMaxPrice != 0) {
                let side0 = '';
                let side1 = '';
                let price0 = 0;
                let price1 = 0;

                if (sellMinPrice + buyMaxPrice < preSellMinPrice + preBuyMaxPrice) {
                    side0 = 'sell';
                    side1 = 'buy';
                    price0 = endPrice + diff / 2;
                    price1 = endPrice - diff / 2;
                }
                else {
                    side0 = 'buy';
                    side1 = 'sell';
                    price0 = endPrice - diff / 2;
                    price1 = endPrice + diff / 2;
                }

                let size = 0.8;
                let order = await broker.submit(price0, size, side0, period, true);
                if (order.status != 'closed') {
                    // 避免订单执行一半取消了
                    let positionAmt = await broker.getPosition();
                    size = Math.abs(positionAmt)
                }
                if (size > 0) {
                    let order = await broker.submit(price1, size, side1, period, true, true);
                    if (order.status == 'closed') {
                        logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
                    }
                    else {
                        let positionAmt = await broker.getPosition();
                        if (positionAmt == 0) {
                            logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
                        }
                        else {
                            price1 = (price0 + price1) / 2
                            let order = await broker.submit(price1, Math.abs(positionAmt), side1, period, true, true);
                            if (order.status != 'closed') {
                                await exchange.myClose();
                            }
                            logger.log('win: %d, lose: %d, total: %d', winTimes, ++loseTimes, winTimes + loseTimes);
                        }
                    }
                }
            }

            preBuyMaxPrice = buyMaxPrice;
            preSellMinPrice = sellMinPrice;
            preDiff = diff;

            while (exchange.milliseconds() - time < period) {
                await sleep(100);
            }

            logger.log('%d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d',
                num++, amount, buyAmount, sellAmount, buySum, sellSum, startPrice, endPrice, buyMaxPrice, buyMinPrice, sellMaxPrice, sellMinPrice, maxPrice, minPrice, diff, buyMaxPrice / sellMinPrice);


        }
        catch (e) {
            logger.log("error: %s", e);
        }
    }

})()