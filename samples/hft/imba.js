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

function getOrderbookInfo(orderbook, orderbookPre, amount, tradesInfo, priceGrain) {
    let bids = orderbook.bids;
    let asks = orderbook.asks;
    let accBidAmount = 0;
    let bid1 = bids[0][0];
    let ask1 = asks[0][0];
    let mid = (bid1 + ask1) / 2;

    let maxSpread = tradesInfo.maxSpread;
    let minSpread = tradesInfo.minSpread;

    let bidAmount = amount;
    let pressBid = 0;
    let bestBidPrice = bid1;
    let layeringBidPrice = bid1;
    let layeringBidAmount = 0;
    let imbaBid = 0;
    let bidsPre = orderbookPre.bids;
    let accBidAmounts = [];

    for (let i = 0, len = bids.length; i < len; i++) {
        let bid = bids[i];
        accBidAmount += bid[1];
        accBidAmounts[i] = accBidAmount;
        let bidPre = bidsPre[i];
        imbaBid += (bid[0] >= bidPre[0] ? 1 : 0) * bid[1] - (bid[0] <= bidPre[0] ? 1 : 0) * bidPre[1];
        if (pressBid == 0 && (accBidAmount / (bid[0] - mid)) * minSpread > 1) {
            pressBid = bid[0];
        }
        if (accBidAmount < bidAmount) {
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
    let pressAsk = 0;
    let askAmount = amount;
    let accAskAmounts = [];
    for (let i = 0, len = asks.length; i < len; i++) {
        let ask = asks[i];
        accAskAmount += ask[1];
        accAskAmounts[i] = accAskAmount;
        let askPre = asksPre[i];
        imbaAsk += (ask[0] <= askPre[0] ? 1 : 0) * ask[1] - (ask[0] >= askPre[0] ? 1 : 0) * askPre[1];
        if (pressAsk == 0 && (accAskAmount / (ask[0] - mid)) * maxSpread > 1) {
            pressAsk = ask[0];
        }
        if (accAskAmount < askAmount) {
            bestAskPrice = ask[0];
        }
        else if (ask[1] > amount) {
            layeringAskPrice = ask[0];
            layeringAskAmount = ask[1];
            break;
        }
    }
    pressBid = pressBid == 0 ? bid1 + priceGrain : pressBid;
    pressAsk = pressAsk == 0 ? ask1 - priceGrain : pressAsk;
    let imbalance = imbaBid - imbaAsk;

    // if (imbalance > 0) {
    //     let index = accAskAmounts.findIndex(function (accAmount) {
    //         return accAmount > amount - imbalance;
    //     });
    //     bestAskPrice = index == 0 ? ask1 : asks[index - 1];
    // }
    // else {
    //     let index = accBidAmounts.findIndex(function (accAmount) {
    //         return accAmount > amount + imbalance;
    //     });
    //     bestBidPrice = index == 0 ? bid1 : bid1[index - 1];
    // }

    return {
        bid1,
        ask1,
        bestBidPrice,  // 基于成交量计算
        bestAskPrice,
        layeringBidPrice,
        layeringBidAmount,
        layeringAskPrice,
        layeringAskAmount,
        imbalance: imbaBid - imbaAsk,  // 订单不平衡
        pressAsk,  // 基于价格最大变动速度和订单压力计算的买卖价
        pressBid
    }
}

function getTradesInfo(trades) {
    let amount = 0;
    let buyAmount = 0;
    let sellAmount = 0;
    let maxSpread = 0;
    let minSpread = 0;
    let sumSpread = 0;
    let pricePre = 0;

    for (let i = 0, len = trades.length; i < len; i++) {
        let trade = trades[i];
        if (trade.side == 'buy') {
            buyAmount += trade.amount;
        }
        else {
            sellAmount += trade.amount;
        }
        if (pricePre != 0) {
            let spread = (trade.price - pricePre) / trade.amount;
            maxSpread = Math.max(maxSpread, spread);
            minSpread = Math.min(minSpread, spread);
            sumSpread += spread;
        }

        pricePre = trade.price
    }
    amount = buyAmount + sellAmount;
    let overBuy = buyAmount / amount > 0.618;
    let overSell = sellAmount / amount > 0.618;
    return {
        amount,
        buyAmount,
        sellAmount,
        overBuy,
        overSell,
        maxSpread,
        minSpread,
        sumSpread
    };
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
    let size = 8;
    let preStatus = "";

    let tradesInfo;
    let orderbookInfo;
    let tradesInfoPre;
    let orderbookInfoPre;
    let orderbookInfoPre1;
    let holdNumTick = 0; // 持仓时间
    let orderbookPre;
    let orderbook;

    let layerStatus = '';
    let layerStatusPre = '';
    let position = 0;
    let waitTime = 1000;
    let shape = '';

    let bidPrices = [];
    let askPrices = [];

    function close(way) {
        broker.close(way, costPrice, closePrice);
        costPrice = 0;
        closePrice = 0;
    }

    while (true) {
        try {
            var time = exchange.milliseconds();
            if (!orderId && position == 0) {
                var trades = await exchange.fetchTrades(symbol, time - 4 * 1000, 1000);
                tradesInfoPre = tradesInfo;
                tradesInfo = getTradesInfo(trades);
                holdNumTick = 0;
            }
            else {
                holdNumTick++
            }
            // 计算订单薄
            orderbookPre = orderbook;
            orderbook = await exchange.fetchOrderBook(symbol, 50);
            if (!orderbookPre) {
                continue;
            }
            orderbookInfoPre = orderbookInfo;
            orderbookInfo = getOrderbookInfo(orderbook, orderbookPre, tradesInfo.amount/2, tradesInfo, priceGrain);

            logger.log('spread: %d, max spread %d, min spread %d, press bid: %d, press ask: %d, imba: %d',
                tradesInfo.sumSpread, tradesInfo.maxSpread, tradesInfo.minSpread, orderbookInfo.pressBid, orderbookInfo.pressAsk, orderbookInfo.imbalance);
            logger.log('layer bid: %d, amount: %d, layer ask: %d, amount: %d, bestBid: %d, bestAsk: %d, bid1: %d, ask1:%d',
                orderbookInfo.layeringBidPrice, orderbookInfo.layeringBidAmount, orderbookInfo.layeringAskPrice, orderbookInfo.layeringAskAmount, orderbookInfo.bestBidPrice, orderbookInfo.bestAskPrice,
                orderbookInfo.bid1, orderbookInfo.ask1);

            layerStatusPre = layerStatus;
            layerStatus = (orderbookInfo.layeringBidAmount > 0 ? '1' : '0') + (orderbookInfo.layeringAskAmount > 0 ? '1' : '0');

            let bid1 = orderbookInfo.bid1
            let ask1 = orderbookInfo.ask1

            let ratioBid = orderbookInfo.bestAskPrice/orderbookInfo.bestBidPrice;
            let ratioAsk = orderbookInfo.bestBidPrice/orderbookInfo.bestAskPrice;
            let bestBid = orderbookInfo.bestBidPrice + priceGrain;
            let bestAsk = orderbookInfo.bestAskPrice - priceGrain;

            status = 'none';
            if (layerStatus == '10' && layerStatusPre != '10') {
                bestBid = ask1;
                status = 'long';
                shape = layerStatus;
            }
            else if (layerStatus == '01' && layerStatusPre != '01') {
                bestAsk = bid1;
                status = 'short';
                shape = layerStatus;
            }
            if (position > 0 && layerStatus != '10') {
                bestAsk = bid1;
            }
            else if (position < 0 && layerStatus != '01') {
                bestBid = ask1;
            }


            // else {
            //     if (tradesInfo.sumSpread > tradesInfoPre.sumSpread && orderbookInfo.imbalance > 0) {
            //         status = 'long';
            //         shape = 'guard';
            //     }
            //     else if (tradesInfo.sumSpread < tradesInfoPre.sumSpread > 0 && orderbookInfo.imbalance < 0) {
            //         status = 'short';
            //         shape = 'guard'; 
            //     }
            // }
            logger.log("status: %s, shape: %s, bestBid: %d, beskAsk: %d", status, shape, bestBid, bestAsk);

            let trading = false;

            if (orderId) {
                let canceled = await broker.cancelOrder(orderId);
                if (!canceled && position != 0) {
                    close(position > 0 ? 'long' : 'short');
                }
                orderId = null;
            }

            let positionAmt = await broker.getPosition();
            // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
            if (positionAmt < 0) {
                closePrice = bestBid;
                if (holdNumTick > 9) {
                    closePrice = bid1;
                }
                let order = await broker.buy(closePrice, -positionAmt, waitTime, false, true);
                if (order.status == "open") {
                    orderId = order.orderId;
                }
                else {
                    close('short');
                }
                trading = true;
            }
            else if (positionAmt > 0) {
                closePrice = bestAsk;
                if (holdNumTick > 9) {
                    closePrice = ask1;
                }
                let order = await broker.sell(closePrice, positionAmt, waitTime, false, true);
                if (order.status == "open") {
                    orderId = order.orderId;
                }
                else {
                    close('long');
                }
                trading = true;
            }
            else {
                position = 0;
                if (status == 'long') {
                    costPrice = bestBid;
                    let order = await broker.buy(costPrice, size, waitTime, false, false);
                    if (order.status == 'open') {
                        orderId = order.orderId;
                    }
                    else {
                        position = size;
                    }
                    trading = true;
                }
                else if (status == "short") {
                    costPrice = bestAsk;
                    let order = await broker.sell(costPrice, size, waitTime, false, false);
                    if (order.status == 'open') {
                        orderId = order.orderId;
                    }
                    else {
                        position = -size;
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