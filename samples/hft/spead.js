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

    var symbol = "PHB/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let pricePresision = parseInt(market.precision.price);

    let broker = new MyBroker(exchange, symbol);

    let priceGrain = parseFloat(Math.pow(10, 0 - pricePresision).toPrecision(pricePresision));

    let bid1 = 0;
    let ask1 = 0;
    let winTimes = 0;
    let loseTimes = 0;
    let stopTimes = 0;
    let hasError = false;
    let orderbook = null;

    let preTime = 0;
    let waitTime = 0;
    let openTime = 0;
    let trades = [];
    let bidPrices = [];
    let askPrices = [];
    let targetPrice = 0;
    let costPrice = 0;
    let stopPrice = 0;
    let size = 7;
    let factor = 1.618;
    let orderId = null;
    let stop = false;
    let overBuy = false;
    let overSell = false;
    let amount = 0;

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

    let period = 5 * 60 * 1000;
    let stopPeriod = 60 * 1000;

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            if (hasError) {
                await exchange.cancelAllOrders(symbol);
                await exchange.myClose();
            }
            let time = exchange.milliseconds();
            if (time > preTime + 15 * 1000 || orderId) {
                preTime = time;
                trades = await exchange.fetchTrades(symbol, time - period, 1000)
                let buyAmount = 0;
                let sellAmount = 0;
                for (let i = 0, len = trades.length; i < len; i++) {
                    let trade = trades[i];
                    trade.side == 'buy' ? buyAmount += trade.amount : sellAmount += trade.amount;
                }
                amount = buyAmount + sellAmount;
                overBuy = buyAmount > amount * 0.618;
                overSell = sellAmount > amount * 0.618;
            }

            let positionAmt = await broker.getPosition();
            if (positionAmt != 0) {
                if (positionAmt > 0 && overSell || positionAmt < 0 && overBuy) {
                    logger.log('cancel and close!');
                    await exchange.cancelAllOrders(symbol);
                    await exchange.myClose();
                }
                else if (!stop && exchange.milliseconds() > stopPeriod + openTime) {
                    logger.log('cancel!');
                    let canceled = await broker.cancelOrder(orderId);
                    if (canceled) {
                        positionAmt = await broker.getPosition();
                        let side = positionAmt > 0 ? 'sell' : 'buy';
                        let size = positionAmt > 0 ? positionAmt : -positionAmt;
                        let order = await broker.submit(stopPrice, size, side, 500, false, true);
                        orderId = order.id;
                        stop = true;
                    }
                    else {
                        logger.log('win: %d, lose: %d, stop: %d, total: %d', ++winTimes, loseTimes, stopTimes, winTimes + loseTimes + stopTimes);
                    }
                }
                await sleep(100);
                continue;
            }
            else if (orderId) {
                logger.log('win: %d, lose: %d, stop: %d, total: %d', ++winTimes, loseTimes, stopTimes, winTimes + loseTimes + stopTimes);
            }
            orderId = null;
            stop = false;

            orderbook = await exchange.fetchOrderBook(symbol, 10);
            bid1 = orderbook.bids[0][0]
            ask1 = orderbook.asks[0][0]

            let status = 'none';
            if (bidPrices.length > 6) {
                bidPrices = bidPrices.slice(-6);
                askPrices = askPrices.slice(-6);
                let maxBid = Math.max(...bidPrices);
                let minAsk = Math.min(...askPrices);
                if (bid1 > maxBid * 1.0008) {
                    status = 'up';
                    costPrice = bid1 + priceGrain;
                    targetPrice = costPrice * (1 + factor - factor * bid1 / maxBid)
                    stopPrice = costPrice * (2 - bid1 / maxBid)
                }
                else if (ask1 < minAsk * 0.9992) {
                    status = 'down';
                    costPrice = ask1 - priceGrain;
                    targetPrice = costPrice * (1 + factor - factor * ask1 / minAsk);
                    stopPrice = costPrice * (2 - ask1 / minAsk);
                }
                // logger.log('maxBid: %d, bid1: %d, minAsk: %d, ask1: %d', maxBid, bid1, minAsk, ask1);
            }
            bidPrices.push(bid1);
            askPrices.push(ask1);

            let trading = false;

            let side0 = null;
            let side1 = null;
            if (overBuy && status == 'down') {
                side0 = 'buy';
                side1 = 'sell';
                waitTime = orderbook.bids[0][1] * period * 2 / amount;
                logger.log('side: %s, cost: %d, target: %d, stop:%d, wait: %d', side0, costPrice, targetPrice, stopPrice, waitTime);
            }
            else if (overSell && status == 'up') {
                side0 = 'sell';
                side1 = 'buy';
                waitTime = orderbook.asks[0][1] * period * 2 / amount;
                logger.log('side: %s, cost: %d, target: %d, stop:%d, wait: %d', side0, costPrice, targetPrice, stopPrice, waitTime);
            }

            if (side0) {
                await broker.submit(costPrice, size, side0, 5000, true, false);
                let positionAmt = await broker.getPosition();
                if (positionAmt != 0) {
                    let order = await broker.submit(targetPrice, size, side1, 1000, false, true);
                    if (order.status == 'closed') {
                        logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
                    }
                    else {
                        orderId = order.orderId;
                        openTime = exchange.milliseconds();
                    }
                }
                trading = true;
            }

            if (!trading) {
                await sleep(100);
            }
            hasError = false;
        }
        catch (e) {
            logger.log("error: %s", e);
            hasError = true
        }
    }

})()