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

let logger = new MyLogger('quant_phb.log');

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
            let order = positionAmt > 0 ? await exchange.createMarketSellOrder(symbol, positionAmt, { "reduceOnly": true }) : await exchange.createMarketBuyOrder(symbol, -positionAmt, { "reduceOnly": true });
            let trades = await exchange.fetchMyTrades(symbol);
            let pnl = trades.reduce(function (mem, trade) {
                if (trade.info.orderId == order.id) {
                    mem += parseFloat(trade.info.realizedPnl) - 2 * trade.fee.cost;
                }
                return mem;
            }, 0);
            pnl > 0 ? winTimes++ : loseTimes++
            logger.log('win: %d, lose: %d, total: %d, pnl: %d', winTimes, loseTimes, winTimes + loseTimes, pnl);
        }
    }

    exchange.forceCancelAllOrders = async function () {
        try {
            await exchange.cancelAllOrders()
        }
        catch (e) {

        }
    }

    let orderbook = null;
    let orderbookPre = null;
    let num = 0;

    let bidPrices = [];
    let askPrices = [];

    logger.log('num, bid1, ask1, status, postionAmt')

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            if (hasError) {
                await exchange.forceCancelAllOrders(symbol);
                await exchange.myClose();
            }
            hasError = false;

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
            else {
                await sleep(100);
                continue;
            }

            let status = 'none';
            if (bid1 > Math.max(...bidPrices)) {
                status = 'bull';
            }
            else if (ask1 < Math.min(...askPrices)) {
                status = 'bear';
            }
            else if (ask1 < Math.max(...askPrices) && ask1 < Math.max(...askPrices.slice(-6))) {
                status = 'bull-end';
            }
            else if (bid1 > Math.min(...bidPrices) && bid1 > Math.min(...bidPrices.slice(-6))) {
                status = 'bear-end';
            }

            let size = 20;
            let positionAmt = await broker.getPosition();
            logger.log('%d, %d, %d, %s, %d', num++, bid1, ask1, status, positionAmt);

            if (positionAmt == 0) {
                if (status == 'bull') {
                    await broker.submit(bid1 - priceGrain, size, 'buy', 800, true);
                }
                else if (status == 'bear') {
                    await broker.submit(ask1 + priceGrain, size, 'sell', 800, true);
                }
            }
            else if (positionAmt > 0 && status == 'bull-end') {
                await broker.submit(ask1 - priceGrain, size, 'sell', 500, true, true);
            }
            else if (positionAmt < 0 && status == 'bear-end') {
                await broker.submit(bid1 + priceGrain, size, 'buy', 500, true, true);
            }

            await sleep(100);
        }
        catch (e) {
            logger.log("error: %s", e);
            hasError = true;
        }
    }

})()