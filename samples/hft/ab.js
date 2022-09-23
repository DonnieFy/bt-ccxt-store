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

    let preBid1 = 0;
    let preAsk1 = 0;
    let bid1 = 0;
    let ask1 = 0;
    let winTimes = 0;
    let loseTimes = 0;
    let hasError = false;
    let orderbook0 = null;
    let orderbook = null;

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
    }
    let preTime = 0;
    let waitTime = 0;

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            if (hasError) {
                await exchange.cancelAllOrders(symbol);
                await exchange.myClose();
            }
            let time = exchange.milliseconds();
            let trades = await exchange.fetchTrades(symbol, time - 10000, 100)
            waitTime = 50000 / trades.length;
            if (waitTime > 2000) {
                waitTime = 2000;
            }

            orderbook0 = orderbook
            orderbook = await exchange.fetchOrderBook(symbol, 10);
            preBid1 = bid1;
            preAsk1 = ask1;
            bid1 = orderbook.bids[0][0]
            ask1 = orderbook.asks[0][0]
            logger.log("bid1: %s, ask1: %d, waitTime: %d", bid1, ask1, waitTime);

            if (!orderbook0) {
                continue;
            }

            let bidAmount = 0;
            let askAmount = 0;
            
            let imbaBid = orderbook.bids.reduce(function(mem, bid, i) {
                bidAmount += bid[1]
                let bidPre = orderbook0.bids[i];
                return mem + (bid[0] >= bidPre[0] ? 1 : 0) * bid[1] - (bid[0] <= bidPre[0] ? 1 : 0) * bidPre[1];
            }, 0);
            let imbaAsk = orderbook.asks.reduce(function(mem, ask, i) {
                askAmount += ask[1]
                let askPre = orderbook0.asks[i];
                return mem + (ask[0] <= askPre[0] ? 1 : 0) * ask[1] - (ask[0] >= askPre[0] ? 1 : 0) * askPre[1]
            }, 0);
            let imbalance = imbaBid - imbaAsk;
            let dif = imbalance > 0 ? Math.round(imbalance/askAmount) : Math.round(imbalance/bidAmount);
            let bidPrice = bid1 + dif * priceGrain;
            let askPrice = ask1 + dif * priceGrain;

            let trading = false;
            if (askPrice >= bidPrice * 1.0008) {
                logger.log("symbol: %s, bid: %d, ask: %d, bid price: %d, ask price: %d, imba: %d", symbol, bid1, ask1, bidPrice, askPrice, imbalance);
                logger.log("bidAmount: %d, askAmount: %d", bidAmount, askAmount);
                let size = 7;

                let promise1 = exchange.createLimitOrder(symbol, 'buy', size, bidPrice);
                let promise2 = exchange.createLimitOrder(symbol, 'sell', size, askPrice);
                let orders = await Promise.all([promise1, promise2]);

                let time = 0
                let closed = false;
                
                while (time < waitTime) {
                    let openOrders = await exchange.fetchOpenOrders(symbol);
                    if (openOrders.length == 0) {
                        closed = true;
                        break;
                    }
                    await sleep(200);
                    time+=200;
                }
                if (closed) {
                    logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
                }
                else {
                    let p1 = broker.cancelOrder(orders[0].id);
                    let p2 = broker.cancelOrder(orders[1].id);
                    let canceleds = await Promise.all([p1, p2]);
                    if (!canceleds[0] && !canceleds[1]) {
                        logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
                    }
                    else {
                        await exchange.myClose();
                    }
                }
                // let status = 'none'
                // if (imbalance > askAmount && bidAmount > askAmount) {
                //     status = 'long';
                //     bidPrice += Math.round(imbalance/askAmount) * priceGrain;
                // }
                // else if (-imbalance > bidAmount && askAmount > bidAmount) {
                //     status = 'short';
                //     askPrice += Math.round(imbalance/bidAmount) * priceGrain;
                // }
                // else if (bidAmount - Math.abs(imbalance) > askAmount) {
                //     status = 'long';
                // }
                // else if (askAmount - Math.abs(imbalance) > bidAmount) {
                //     status = 'short';
                // }
                // trading = true;
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