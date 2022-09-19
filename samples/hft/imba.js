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

function getOrderbookInfo(orderbook, orderbookPre, amount) {
    let bids = orderbook.bids;
    let asks = orderbook.asks;
    let accBidAmount = 0;
    let bid1 = bids[0][0];
    let ask1 = asks[0][0];
    let mid = (bid1+ask1)/2;
    let pressBuy = 0;
    

    let bestBidPrice = bid1;
    let layeringBidPrice = bid1;
    let layeringBidAmount = 0;
    let imbaBid = 0;
    let bidsPre = orderbookPre.bids;
    for (let i = 0, len = bids.length; i < len; i++) {
        let bid = bids[i];
        accBidAmount += bid[1];
        let bidPre = bidsPre[i];
        imbaBid += (bid[0] >= bidPre[0] ? 1 : 0) * bid[1] - (bid[0] <= bidPre[0] ? 1 : 0) * bidPre[1];
        if (accBidAmount < amount) {
            bestBidPrice = bid[0];
        }
        else if (bid[1] > amount) {
            layeringBidPrice = bid[0];
            layeringBidAmount = bid[1];
            break;
        }
    }

    let accAskAmount = 0;
    let bestAskPrice = ask1;
    let layeringAskPrice = ask1;
    let layeringAskAmount = 0;
    let imbaAsk = 0;
    let asksPre = orderbookPre.asks;
    for (let i = 0, len = asks.length; i < len; i++) {
        let ask = asks[i];
        accAskAmount += ask[1];
        let askPre = asksPre[i];
        imbaAsk += (ask[0] <= askPre[0] ? 1 : 0) * ask[1] - (ask[0] >= askPre[0] ? 1 : 0) * askPre[1];
        if (accAskAmount < amount) {
            bestAskPrice = ask[0];
        }
        else if (ask[1] > amount) {
            layeringAskPrice = ask[0];
            layeringAskAmount = ask[1];
            break;
        }
    }
    return {
        bid1,
        ask1,
        bestBidPrice,
        bestAskPrice,
        layeringBidPrice,
        layeringBidAmount,
        layeringAskPrice,
        layeringAskAmount,
        imbalance: imbaBid - imbaAsk
    }
}

function getTradesInfo(trades) {
    let amount = 0;
    let buyAmount = 0;
    let sellAmount = 0;
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
    let overBuy = buyAmount / amount > 0.618;
    let overSell = sellAmount / amount > 0.618;
    return { amount, buyAmount, sellAmount, overBuy, overSell };
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
        this.winTimes = 0;
        this.loseTimes = 0;
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

    close(status, openPrice, closePrice) {
        if (status == "long") {
            closePrice >= openPrice * 1.0008 ? this.winTimes++ : this.loseTimes++
        }
        else if (status == "short") {
            closePrice <= openPrice * 0.9992 ? this.winTimes++ : this.loseTimes++;
        }
        logger.log('win: %d, lose: %d, total: %d', this.winTimes, this.loseTimes, this.winTimes + this.loseTimes);
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
    let orderId = null;
    let costPrice = 0;
    let closePrice = 0;
    let preTime = 0;
    let status = "none";
    let size = 5;
    let preStatus = "";

    let tradesInfo;
    let orderbookInfo;
    let tradesInfoPre;
    let orderbookInfoPre;
    let orderbookInfoPre1;
    let holdNumTick = 0; // 持仓时间

    function close(way) {
        broker.close(way, costPrice, closePrice);
        costPrice = 0;
        closePrice = 0;
    }

    while (true) {
        try {
            var time = exchange.milliseconds();
            if (!orderId) {
                if (time > preTime + 4 * 1000) {
                    preTime = time;
                    var trades = await exchange.fetchTrades(symbol, time - 4 * 1000, 1000);
                    tradesInfoPre = tradesInfo;
                    tradesInfo = getTradesInfo(trades);
                }
                holdNumTick = 0;
            }
            else {
                holdNumTick++
            }
            // 计算订单薄
            const orderbook = await exchange.fetchOrderBook(symbol, 50);
            orderbookInfoPre1 = orderbookInfoPre
            orderbookInfoPre = orderbookInfo;
            orderbookInfo = getOrderbookInfo(orderbook.bids, orderbook.asks, tradesInfo.amount * Math.pow(0.8, holdNumTick));

            let bestBid = orderbookInfo.bestBidPrice + priceGrain;
            let bestAsk = orderbookInfo.bestAskPrice - priceGrain;
            let bid1 = orderbookInfo.bid1
            let ask1 = orderbookInfo.ask1

            let askRatio = orderbookInfo.layeringAskPrice / orderbookInfo.bestAskPrice;
            let bidRatio = orderbookInfo.layeringBidPrice / orderbookInfo.bestBidPrice;
            let signal = askRatio + bidRatio - 2;

            let askRatio1 = bestAsk / (bid1 + priceGrain);
            let bidRatio1 = bestBid / (ask1 - priceGrain);
            let signal1 = askRatio1 + bidRatio1 - 2;

            let waitTime = 1500;
            let shape = ''

            status = 'none';
            if (!orderbookInfoPre) {
                status = 'none';
            }
            else {
                let layeringBidUp = orderbookInfo.layeringBidPrice > orderbookInfoPre.layeringBidPrice;
                let layeringAskDown = orderbookInfo.layeringAskPrice < orderbookInfoPre.layeringAskPrice;
                let overBuy = orderbookInfo.overBuy;
                let overSell = orderbookInfo.overSell;
                if (layeringBidUp && layeringAskDown) {
                    orderbookInfo.layeringBidAmount > orderbookInfo.layeringAskAmount ? layeringAskDown=false : layeringBidUp=false;
                }
                if (layeringBidUp && signal > 0) {
                    status = 'long';
                    shape = 'layer up'
                    if (overBuy) {
                        bestBid = bid1 + priceGrain
                        waitTime = 500;
                        shape = 'layer up aggressive'
                    }
                }
                else if (layeringAskDown && signal < 0) {
                    status = 'short';
                    shape = 'layer down'
                    if (overSell) {
                        bestAsk = ask1 - priceGrain
                        waitTime = 500;
                        shape = 'layer down aggressive'
                    }
                }
                else if (signal1 > 0 && overBuy && !layeringAskDown) {
                    status = 'long';
                    shape = 'common'
                }
                else if (signal1 < 0 && overSell && !layeringBidUp) {
                    status = 'short'
                    shape = 'common'
                }
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

                let positionAmt = await broker.getPosition();
                // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
                if (positionAmt < 0) {
                    closePrice = status == 'short' ? bestBid : bid1;
                    if (holdNumTick > 3) {
                        closePrice = ask1;
                    }
                    let order = await broker.buy(closePrice, -positionAmt, 1000, false, true);
                    if (order.status == "open") {
                        orderId = order.orderId;
                    }
                    else {
                        close('short');
                    }
                }
                else if (positionAmt > 0) {
                    closePrice = status == 'long' ? bestAsk : ask1;
                    if (holdNumTick > 3) {
                        bestAsk = bid1;
                    }
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
            else if (bestAsk >= bestBid * 1.0008) {
                logger.log("status: %s, shape: %s, bestBid: %d, beskAsk: %d, signal: %d", status, shape, bestBid, bestAsk, signal);
                if (status == 'long') {
                    costPrice = bestBid;
                    let order = await broker.buy(costPrice, size, waitTime, true, false);
                    if (order.status == 'closed') {
                        closePrice = bestAsk;
                        order = await broker.sell(closePrice, size, 3000 - waitTime, false, true);
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
                    let order = await broker.sell(costPrice, size, waitTime, true, false);
                    if (order.status == 'closed') {
                        closePrice = bestBid;
                        order = await broker.buy(closePrice, size, 3000 - waitTime, false, true);
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
        catch (e) {
            logger.log(e.stack);
        }
    }

})()