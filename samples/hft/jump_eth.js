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

let logger = new MyLogger('quant_eth.log');

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

    var symbol = "1000LUNC/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let pricePresision = parseInt(market.precision.price);

    let broker = new MyBroker(exchange, symbol);

    let priceGrain = parseFloat(Math.pow(10, 0 - pricePresision).toPrecision(pricePresision));

    let winTimes = 0;
    let loseTimes = 0;
    let hasError = false;

    exchange.myClose = async function () {
        let positionAmt = await broker.getPosition();
        if (positionAmt != 0) {
            if (positionAmt > 0) {
                await exchange.createMarketSellOrder(symbol, positionAmt, { "reduceOnly": true })
            }
            else {
                await exchange.createMarketBuyOrder(symbol, -positionAmt, { "reduceOnly": true })
            }
            logger.log('win: %d, lose: %d, total: %d', winTimes, ++loseTimes, winTimes + loseTimes);
        }
        else {
            logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
        }
    }

    exchange.forceCancelAllOrders = async function() {
        try {
            await exchange.cancelAllOrders()
        }
        catch(e) {

        }
    }

    let period = 8 * 1000;
    let orderbook = null;
    let orderbookPre = null;
    let num = 0;
    let startPrice = 0;
    let endPrice = 0;
    let bidPrices = [];
    let askPrices = [];

    logger.log('num, bid1, ask1, position')

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            if (hasError) {
                await exchange.forceCancelAllOrders(symbol);
                await exchange.myClose();
            }
            hasError = false;

            let time = exchange.milliseconds();
            orderbookPre = orderbook;
            orderbook = await exchange.fetchOrderBook(symbol, 10);

            if (!orderbookPre) {
                await sleep(100);
                continue;
            }

            let bid1 = orderbook.bids[0][0];
            let ask1 = orderbook.asks[0][0];

            let preBid1 = orderbookPre.bids[0][0];
            let preAsk1 = orderbookPre.asks[0][0];

            bidPrices.push(preBid1);
            askPrices.push(preAsk1);
            if (bidPrices.length > 7) {
                bidPrices = bidPrices.slice(-7);
                askPrices = askPrices.slice(-7);
            }

            let side0 = '';
            let side1 = '';

            let bid1Jump = bid1 - preAsk1;
            if (bid1 > Math.max(...bidPrices) && bid1 > preAsk1) {
                startPrice = bid1 - priceGrain;
                endPrice = ask1 + bid1Jump;
                side0 = 'buy';
                side1 = 'sell';
            }
            let askJump = ask1 - preBid1;
            if (ask1 < Math.min(...askPrices) && ask1 < preBid1) {
                startPrice = ask1 + priceGrain;
                endPrice = bid1 + askJump;
                side0 = 'sell';
                side1 = 'buy';
            }

            logger.log('%d, %d, %d, %s', num++, bid1, ask1, side0);

            if (side0 == '') {
                await sleep(200);
                continue;
            }

            let size = 20;
            let order = await broker.submit(startPrice, size, side0, 500, true, false);
            if (order.status != 'closed') {
                // 避免订单执行一半取消了
                let positionAmt = await broker.getPosition();
                size = Math.abs(positionAmt)
            }
            if (size > 0) {
                order = await broker.submit(endPrice, size, side1, 800, false, true);
                if (order.status == 'closed') {
                    logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
                }
                else {
                    while (exchange.milliseconds() - time < period) {
                        await sleep(100);
                        let order0 = await exchange.fetchOrder(order.orderId, symbol);
                        if (order0.status == 'closed') {
                            break;
                        }
                    }
                    await exchange.forceCancelAllOrders(symbol);
                    await exchange.myClose();
                }
            }
            orderbook = null;
        }
        catch (e) {
            logger.log("error: %s", e);
            hasError = true;
        }
    }

})()