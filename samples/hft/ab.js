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

    let winTimes = 0;
    let loseTimes = 0;

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        const orderbook = await exchange.fetchOrderBook(symbol, 10);
        let bid1 = orderbook.bids[0][0]+priceGrain
        let ask1 = orderbook.asks[0][0]-priceGrain

        let trading = false;
        if (ask1 >= bid1 * 1.001) {
            logger.log("bid: %d, ask: %d", bid1, ask1);
            let size = 8;
            let promise1 = exchange.createLimitOrder(symbol, 'buy', size, bid1);
            let promise2 = exchange.createLimitOrder(symbol, 'sell', size, ask1);
            let orders = await Promise.all([promise1, promise2]);
            await sleep(200);
            let p1 = broker.cancelOrder(orders[0].id);
            let p2 = broker.cancelOrder(orders[1].id);
            let canceleds = await Promise.all([p1, p2]);
            if (!canceleds[0] && !canceleds[1]) {
                winTimes++
                logger.log('win: %d, lose: %d, total: %d', winTimes, loseTimes, winTimes + loseTimes);
            }
            else {
                let positionAmt = await broker.getPosition();
                if (positionAmt != 0) {
                    loseTimes++;
                    if (positionAmt > 0) {
                        await exchange.createMarketSellOrder(symbol, positionAmt, { "reduceOnly": true })
                    }
                    else {
                        await exchange.createMarketBuyOrder(symbol, -positionAmt, { "reduceOnly": true })
                    }
                    logger.log('win: %d, lose: %d, total: %d', winTimes, loseTimes, winTimes + loseTimes);
                }
            }
            trading = true;
        }
        if (!trading) {
            await sleep(100);
        }
    }

})()