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

    var symbol = "AMB/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let pricePresision = parseInt(market.precision.price);

    let broker = new MyBroker(exchange, symbol);

    let priceGrain = parseFloat(Math.pow(10, 0 - pricePresision).toPrecision(pricePresision));
    let orderId = null;
    let costPrice = 0;
    let closePrice = 0;
    let stopLossPrice = 0;
    let preTime = 0;
    let status = "none";
    let amount = 0;
    let buyAmount = 0;
    let sellAmount = 0;
    let winTimes = 0;
    let loseTimes = 0;
    let size = 250;
    let cancelTime = 0;
    let preStatus = "";

    function close(way) {
        if (way == "long") {
            closePrice >= costPrice * 1.0008 ? winTimes++ : loseTimes++;
        }
        else if (way == "short") {
            closePrice <= costPrice * 0.9992 ? winTimes++ : loseTimes++;
        }
        costPrice = 0;
        closePrice = 0;
    }

    while (true) {
        var time = exchange.milliseconds();
        if (!orderId) {
            if (time > preTime + 8 * 1000) {
                logger.log('win: %d, lose: %d, total: %d', winTimes, loseTimes, winTimes + loseTimes);
                preTime = time;
                amount = buyAmount = sellAmount = 0;
                var trades = await exchange.fetchTrades(symbol, time - 8 * 1000, 1000);
                for (let i = 0, len = trades.length; i < len; i++) {
                    let trade = trades[i];
                    if (trade.side == 'buy') {
                        buyAmount += trade.amount;
                    }
                    else {
                        sellAmount += trade.amount;
                    }
                }
                amount = buyAmount + sellAmount;
            }
        }
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        const orderbook = await exchange.fetchOrderBook(symbol, 50);
        let bestBid = getBestBidPrice(orderbook.bids, amount) + priceGrain;
        let bestAsk = getBestAskPrice(orderbook.asks, amount) - priceGrain;
        let bid1 = orderbook.bids[0][0]
        let ask1 = orderbook.asks[0][0]
        bestBid = bestBid > ask1 ? ask1 : bestBid;
        bestAsk = bestAsk < bid1 ? bid1 : bestAsk;

        let askRatio = bestAsk / (bid1 + priceGrain);
        let bidRatio = bestBid / (ask1 - priceGrain);

        if (bestAsk >= ask1 * 1.001 && buyAmount > amount * 0.618) {
            bestBid = ask1;
            status = "long";
        }
        else if (bestBid <= bid1 * 0.999 && sellAmount > amount * 0.618) {
            bestAsk = bid1;
            status = "short";
        }
        else {
            status = "none";
        }

        let trading = false;

        if (orderId) {
            let canceled = await broker.cancelOrder(orderId);
            orderId = null;
            if (!canceled) {
                // 已经执行了，开始下一个买卖
                close(preStatus);
                continue;
            }
            cancelTime++;

            let positionAmt = await broker.getPosition();
            // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
            if (positionAmt < 0) {
                bestBid += cancelTime * priceGrain;
                closePrice = status == "short" ? bestBid : ask1;
                let order = await broker.buy(closePrice, -positionAmt, 1000, false, true);
                if (order.status == "open") {
                    orderId = order.orderId;
                }
                else {
                    close('short');
                }
            }
            else if (positionAmt > 0) {
                bestAsk -= cancelTime * priceGrain
                closePrice = status == "long" ? bestAsk : bid1;
                let order = await broker.sell(closePrice, positionAmt, 1000, false, true);
                if (order.status == "open") {
                    orderId = order.orderId;
                }
                else {
                    close('long');
                }
            }
            trading = true;
        }
        else if (bestAsk >= bestBid * 1.001) {
            cancelTime = 0;
            logger.log("status: %s, bestBid: %d, beskAsk: %d", status, bestBid, bestAsk);
            if (status == 'long') {
                costPrice = bestBid;
                let order = await broker.buy(costPrice, size, 200, true, false);
                if (order.status == 'closed') {
                    closePrice = bestAsk;
                    order = await broker.sell(closePrice, size, 3000, false, true);
                    if (order.status == "open") {
                        orderId = order.orderId;
                    }
                    else {
                        close(status);
                    }
                }
                trading = true;
            }
            else if (status == "short") {
                costPrice = bestAsk;
                let order = await broker.sell(costPrice, size, 200, true, false);
                if (order.status == 'closed') {
                    closePrice = bestBid;
                    order = await broker.buy(closePrice, size, 3000, false, true);
                    if (order.status == "open") {
                        orderId = order.orderId;
                    }
                    else {
                        close(status);
                    }
                }
                trading = true;
            }
            preStatus = status;
        }
        if (!trading) {
            await sleep(100);
        }
    }

})()