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

    var symbol = "PHB/BUSD";

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

    let period = 13 * 1000;
    let orderbook = null;
    let orderbookPre = null;
    let num = 0;
    let startPrice = 0;
    let endPrice = 0;

    let preLayerAsk = 0;
    let preLayerBid = 0;
    let preLayerAskAmount = 0;
    let preLayerBidAmount = 0;
    let layerAsk = 0
    let layerBid = 0
    let layerAskAmount = 0
    let layerBidAmount = 0

    logger.log('num, bid1, ask1, amount, layerBidPrice, layerBidAmount, layerAskPrice, layerAskAmount')

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
            let trades = await exchange.fetchTrades(symbol, time - period, 1000)
            let buyAmount = 0;
            let sellAmount = 0;
            for (let i = 0, len = trades.length; i < len; i++) {
                let trade = trades[i];
                trade.side == 'buy' ? buyAmount += trade.amount : sellAmount += trade.amount;
            }
            let amount = buyAmount + sellAmount;

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

            let layerBidIndex = orderbook.bids.findIndex(function (bid) {
                return bid[1] > amount;
            })
            let layerAskIndex = orderbook.asks.findIndex(function (ask) {
                return ask[1] > amount;
            })
            preLayerAsk = layerAsk;
            preLayerBid = layerBid;
            preLayerAskAmount = layerAskAmount;
            preLayerBidAmount = layerBidAmount;
            layerAsk = layerAskIndex == -1 ? 0 : orderbook.asks[layerAskIndex][0]
            layerBid = layerBidIndex == -1 ? 0 : orderbook.bids[layerBidIndex][0]
            layerAskAmount = layerAskIndex == -1 ? 0 : orderbook.asks[layerAskIndex][1]
            layerBidAmount = layerBidIndex == -1 ? 0 : orderbook.bids[layerBidIndex][1]

            let bidJump = bid1 - preAsk1;
            let askJump = ask1 - preBid1;
            if (preLayerAsk == 0 && layerAsk == 0) {
                if ((ask1 + bidJump) > bid1 * 1.001) {
                    await doLimit('buy', 'sell', bid1 - priceGrain, ask1 + bidJump - priceGrain)
                    orderbook = null;
                }
                else if (preLayerBid == 0 && layerBid == 0 && (bid1 + askJump) < ask1 * 0.999) {
                    await doLimit('sell', 'buy', ask1 + priceGrain, bid1 + askJump + priceGrain)
                    orderbook = null;
                }
            }
            else {
                if (preLayerAsk != 0 && bid1 > preLayerAsk && buyAmount > preLayerAskAmount) {
                    await doMarket('up', bid1, ask1)
                    orderbook = null;
                }
                if (preLayerBid != 0 && ask1 < preLayerBid && sellAmount > preLayerBidAmount) {
                    await doMarket('down', bid1, ask1)
                    orderbook = null;
                }
            }

            logger.log('%d, %d, %d, %d, %d, %d, %d, %d', num++, bid1, ask1, amount, layerBid, layerBidAmount, layerAsk, layerAskAmount);
        }
        catch (e) {
            logger.log("error: %s", e);
            hasError = true;
        }
    }

    async function doLimit(side0, side1, startPrice, endPrice) {
        let size = 8;
        let order = await broker.submit(startPrice, size, side0, 800, true, false);
        if (order.status != 'closed') {
            await exchange.myClose();
            return;
        }
        order = await broker.submit(endPrice, size, side1, 2000, true, true);
        if (order.status == 'closed') {
            logger.log('win: %d, lose: %d, total: %d', ++winTimes, loseTimes, winTimes + loseTimes);
        }
        else {
            await exchange.myClose();
        }
    }

    async function doMarket(status, bid1, ask1) {
        await sleep(300);
        let temp = await exchange.fetchOrderBook(symbol, 5);
        let side0 = '';
        let side1 = '';
        let startPrice = 0;
        let endPrice = 0;
        if (status == 'up') {
            startPrice = ask1;
            if (temp.asks[0][0] <= ask1) {
                side0 = 'sell';
                side1 = 'buy';
                endPrice = ask1 * 0.998;
            }
            else {
                side0 = 'buy';
                side1 = 'sell';
                endPrice = ask1 * 1.002;
            }
        }
        else {
            startPrice = bid1;
            if (temp.bids[0][0] >= bid1) {
                side0 = 'buy';
                side1 = 'sell';
                endPrice = bid1 * 1.002;
            }
            else {
                side0 = 'sell';
                side1 = 'buy';
                endPrice = bid1 * 0.998;
            }
        }

        let size = 8;

        let openTime = exchange.milliseconds();
        logger.log('market: %s, price: %d', side0, startPrice);

        await broker.submit(startPrice, size, side0, 800, true);
        let positionAmt = await broker.getPosition();
        if (positionAmt == 0) {
            return;
        }

        let order = await broker.submit(endPrice, size, side1, 800, false, true);
        let minBid = 100000;
        let minBid1 = 0;
        let maxAsk = 0;
        let maxAsk1 = 0

        while (true) {
            if (exchange.milliseconds() - openTime > 8 * 1000) {
                break;
            }
            let order0 = await exchange.fetchOrder(order.orderId, symbol);
            if (order0.status == 'closed') {
                break;
            }

            let temp = await exchange.fetchOrderBook(symbol, 5);
            let tempBid = temp.bids[0][0];
            let tempAsk = temp.asks[0][0];
            if (side0 == 'buy') {
                if (tempBid < bid1 * 0.9998) {
                    break;
                }
                if (tempAsk < maxAsk && tempAsk < maxAsk1) {
                    await broker.cancelOrder(order.orderId);
                    let positionAmt = await broker.getPosition();
                    order = await broker.submit(tempAsk, positionAmt, side1, 100, false, true);
                }
            }
            if (side0 == 'sell') {
                if (tempAsk > ask1 * 1.0002) {
                    break;
                }
                if (tempBid > minBid && tempBid > minBid1) {
                    await broker.cancelOrder(order.orderId);
                    let positionAmt = await broker.getPosition();
                    order = await broker.submit(tempBid, -positionAmt, side1, 100, false, true);
                }
            }
            minBid1 = minBid;
            maxAsk1 = maxAsk;
            minBid = Math.min(minBid1, tempBid);
            maxAsk = Math.max(maxAsk1, tempAsk);
            await sleep(100);
        }

        logger.log('market %s', side1)
        await exchange.myClose();
    }

})()