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

    var symbol = "FOOTBALL/USDT";

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
            logger.log('win: %d, lose: %d, stop: %d, total: %d', winTimes, ++loseTimes, stopTimes, winTimes + loseTimes + stopTimes);
        }
    }

    let period = 8 * 1000;
    let orderbook = null;
    let orderbookPre = null;
    let num = 0;
    let preLayerBid = 0;
    let preLayerAsk = 0;
    let position = 0;

    logger.log('num, amount, buySum, sellSum, buySpread, sellSpread, spreadSum, maxPrice, minPrice, layerBidPrice, layerBidAmount, layerAskPrice, layerAskAmount, imbalance, bid1, ask1, position')

    while (true) {
        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        try {
            let time = exchange.milliseconds();
            let trades = await exchange.fetchTrades(symbol, time - period, 1000)
            let buyAmount = 0;
            let sellAmount = 0;
            let lastPrice = 0;
            let buySum = 0;
            let sellSum = 0;
            let buySpread = 0;
            let sellSpread = 0;
            let spreadSum = 0;
            let maxPrice = 0;
            let minPrice = 1000000;
            for (let i = 0, len = trades.length; i < len; i++) {
                let trade = trades[i];
                let spread = 0;
                let price = trade.price;
                // 计算速度
                if (lastPrice == 0) {
                    lastPrice = price;
                }
                else {
                    spread = (price - lastPrice) / trade.amount;
                    lastPrice = price;
                }
                // 收集成交量和速度和
                if (trade.side == 'buy') {
                    buyAmount += trade.amount;
                    buySum += trade.amount * price;
                    buySpread += spread;
                }
                else {
                    sellAmount += trade.amount;
                    sellSum += trade.amount * price;
                    sellSpread += spread;
                }
                spreadSum += spread;
                maxPrice = Math.max(maxPrice, price);
                minPrice = Math.min(minPrice, price);
            }
            amount = buyAmount + sellAmount;

            orderbookPre = orderbook;
            orderbook = await exchange.fetchOrderBook(symbol, 20);

            if (!orderbookPre) {
                await sleep(period);
                continue;
            }

            let bid1 = orderbook.bids[0][0];
            let ask1 = orderbook.asks[0][0];

            bidPrices.push(bid1);
            askPrices.push(ask1);
            if (bidPrices.length > 5) {
                bidPrices = bidPrices.slice(-5);
                askPrices = askPrices.slice(-5);
            }

            let imbaBid = 0;
            let bids = orderbook.bids;
            let bidsPre = orderbookPre.bids;
            let layeringBidPrice = 0;
            let layeringBidAmount = 0;
            for (let i = 0, len = bids.length; i < len; i++) {
                let bid = bids[i];
                let bidPre = bidsPre[i];
                imbaBid += (bid[0] >= bidPre[0] ? 1 : 0) * bid[1] - (bid[0] <= bidPre[0] ? 1 : 0) * bidPre[1];
                if (bid[1] > amount && layeringBidPrice == 0) {
                    layeringBidPrice = bid[0];
                    layeringBidAmount = bid[1];
                }
            }

            let imbaAsk = 0;
            let asks = orderbook.asks;
            let asksPre = orderbookPre.asks;
            let layeringAskPrice = 0;
            let layeringAskAmount = 0;
            for (let i = 0, len = asks.length; i < len; i++) {
                let ask = asks[i];
                let askPre = asksPre[i];
                imbaAsk += (ask[0] <= askPre[0] ? 1 : 0) * ask[1] - (ask[0] >= askPre[0] ? 1 : 0) * askPre[1];
                if (ask[1] > amount && layeringAskPrice == 0) {
                    layeringAskPrice = ask[0];
                    layeringAskAmount = ask[1];
                }
            }

            let imbalance = imbaBid - imbaAsk;

            if (position == 0) {
                if (bid1 >= Math.max(...bidPrices) && layeringAskPrice == 0 && bid1 >= preLayerAsk && preLayerAsk != 0) {
                    position++
                }
                else if (ask1 <= Math.min(...askPrices) && layeringBidPrice == 0 && ask1 <= preLayerBid && preLayerBid != 0) {
                    position--
                }
            }
            else if (position > 0) {
                if (bid1 < Math.max(...bidPrices)) {
                    position--
                }
            }
            else if (position < 0) {
                if (ask1 > Math.min(askPrices)) {
                    position++
                }
            }

            logger.log('%d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d', num++, amount, buySum, sellSum, buySpread, sellSpread, spreadSum, maxPrice, minPrice, layeringBidPrice, layeringBidAmount, layeringAskPrice, layeringAskAmount, imbalance, bid1, ask1, position);

            preLayerAsk = layeringAskPrice;
            preLayerBid = layeringBidPrice;

            while (exchange.milliseconds() - time < period) {
                await sleep(100);
            }
        }
        catch (e) {
            logger.log("error: %s", e);
        }
    }

})()