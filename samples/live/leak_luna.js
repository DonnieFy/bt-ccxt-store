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

class MyTrader {

    constructor() {
        this.buySum = 0;
        this.sellSum = 0;
        this.averageBuyPrice = 0;
        this.averageSellPrice = 0;
        this.maxPrice = 0;
        this.minPrice = 0;
        this.lastPrice = 0;
        this.status = "none"
        this.shape = "none";
        this.buyAmount = 0;
        this.sellAmount = 0;
        this.winTimes = {};
        this.loseTimes = {};
    }

    getBuyAmount() {
        return this.buyAmount;
    }

    getSellAmount() {
        return this.sellAmount;
    }

    getAmount() {
        return this.buyAmount + this.sellAmount;
    }

    getStatus() {
        return this.status;
    }

    getShape() {
        return this.shape;
    }

    addTrades(trades) {
        var buySum = 0;
        var sellSum = 0;
        var buyCount = 0;
        var sellCount = 0;
        var maxPrice = 0;
        var minPrice = 1000000;
        var lastPrice = 0;
        var status = "none";
        var shape = "none";
        for (let i = 0, len = trades.length; i < len; i++) {
            let trade = trades[i];
            if (trade.side == 'buy') {
                buyCount += trade.amount;
                buySum += trade.price * trade.amount;
            }
            else {
                sellCount += trade.amount;
                sellSum += trade.price * trade.amount;
            }
            lastPrice = trade.price;
            maxPrice = Math.max(maxPrice, lastPrice);
            minPrice = Math.min(minPrice, lastPrice)
        }
        let averageBuyPrice = buySum / buyCount;
        let averageSellPrice = sellSum / sellCount;

        if (averageBuyPrice > averageSellPrice) {
            if (lastPrice < averageSellPrice) {
                status = "down";
                shape = 'bsl';
            }
            else if (lastPrice > averageBuyPrice) {
                status = 'up';
                shape = 'lbs';
            }
            else {
                if (averageBuyPrice - lastPrice > lastPrice - averageSellPrice) {
                    status = 'up';
                    shape = 'bls'
                }
                else {
                    status = 'down';
                    shape = 'bls';
                }
            }
        }
        else if (averageBuyPrice < averageSellPrice) {
            if (lastPrice > averageSellPrice) {
                status = "down";
                shape = 'lsb';
            }
            else if (lastPrice < averageBuyPrice) {
                status = 'up';
                shape = 'sbl';
            }
            else {
                if (averageSellPrice - lastPrice > lastPrice - averageBuyPrice) {
                    status = 'up';
                    shape = 'slb'
                }
                else {
                    status = 'down';
                    shape = 'slb'
                }
            }
        }
        this.status = status;
        this.shape = shape;
        this.buyAmount = buyCount;
        this.sellAmount = sellCount;
        this.maxPrice = maxPrice;
        this.minPrice = minPrice;
        this.averageBuyPrice = averageBuyPrice;
        this.averageSellPrice = averageSellPrice;
        this.buySum = buySum;
        this.sellSum = sellSum;
        this.lastPrice = lastPrice;
    }

    log(win) {
        logger.log('status: %s, shape: %s, res: %s', this.status, this.shape, win ? "win" : "lose");
        logger.log('buy sum: %d, sell sum: %d, average buy: %d, average sell: %d, max: %d, min: %d, lastPrice: %d',
            this.buySum, this.sellSum, this.averageBuyPrice, this.averageSellPrice, this.maxPrice, this.minPrice, this.lastPrice);
    }

    logProfit() {
        let keys = new Set();
        Object.keys(this.winTimes).forEach(function(value) {
            keys.add(value)
        });
        Object.keys(this.loseTimes).forEach(function(value) {
            keys.add(value)
        });
        let arr = Array.from(keys);
        for (let key of arr) {
            logger.log('status: %s, win times: %d, lose times: %d', key, this.winTimes[key], this.loseTimes[key]);
        }
    }

    win() {
        let key = this.status + '_' + this.shape;
        if (!this.winTimes[key]) {
            this.winTimes[key] = 0;
        }
        this.winTimes[key]++
        this.log(true);
    }

    lose() {
        let key = this.status + '_' + this.shape;
        if (!this.loseTimes[key]) {
            this.loseTimes[key] = 0;
        }
        this.loseTimes[key]++
        this.log(false);
    }

    complete(openPrice, closePrice) {
        if (this.status == "up") {
            closePrice >= openPrice * 1.0008 ? this.win() : this.lose();
        }
        else if (this.status == "down") {
            closePrice <= openPrice * 0.9992 ? this.win() : this.lose();
        }
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

    var symbol = "LUNA2/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let pricePresision = parseInt(market.precision.price) + 1;

    let broker = new MyBroker(exchange, symbol);
    let trader = new MyTrader();

    let priceGrain = Math.pow(10, 0 - pricePresision);
    let pnl = 0.00005;
    let orderId = null;
    let costPrice = 0;
    let closePrice = 0;
    let preTime = 0;

    while (true) {
        if (!orderId) {
            var time = exchange.milliseconds();
            if (time > preTime + 20 * 1000) {
                trader.logProfit();
                preTime = time;
                var trades = await exchange.fetchTrades(symbol, time - 20 * 1000, 1000);
                trader.addTrades(trades);
            }
        }
        else {
            let canceled = await broker.cancelOrder(orderId);
            orderId = null;
            if (!canceled) {
                // 已经执行了，开始下一个买卖
                closePrice > costPrice ? trader.win() : trader.lose();
                continue;
            }
        }
        let status = trader.getStatus();
        let amount = trader.getAmount();

        // 计算订单薄
        // let average = parseFloat((sum / (buyCount + sellCount)).toPrecision(pricePresision));
        const orderbook = await exchange.fetchOrderBook(symbol, 50);
        let bestBid = getBestBidPrice(orderbook.bids, amount / 4);
        let bestAsk = getBestAskPrice(orderbook.asks, amount / 4);
        let bid1 = orderbook.bids[0][0]
        let ask1 = orderbook.asks[0][0]

        let bidPrice = bestBid * 0.618 + bestAsk * 0.382 + priceGrain
        let askPrice = bestBid * 0.382 + bestAsk * 0.618 - priceGrain
        logger.log("status: %s, bidPrice: %d, askPrice: %d, amount: %d", status, bidPrice, askPrice, amount);

        
        // 执行订单
        // 已经有仓位了，优先退出，并且不管是否退出，开始下个循环
        let positionAmt = await broker.getPosition();
        let trading = false;
        if (positionAmt < 0) {
            let price = status == "down" ? bidPrice : bid1;
            let order = await broker.buy(price, -positionAmt, 200, false, true);
            if (order.status == "open") {
                orderId = order.orderId;
                closePrice = price;
            }
            else {
                trader.complete(costPrice, price);
                costPrice = 0;
                closePrice = 0;
            }
            trading = true;
        }
        else {
            let size = 3;
            if (status == "down") {
                let order = await broker.sell(askPrice, size, 200, true, );
                if (order.status == 'closed') {
                    order = await broker.buy(bidPrice, size, 200, false);
                    if (order.status == "open") {
                        costPrice = askPrice;
                        closePrice = bidPrice;
                        orderId = order.orderId;
                    }
                    else {
                        costPrice = 0;
                        closePrice = 0;
                        trader.complete(askPrice, bidPrice);
                    }
                }
                trading = true;
            }
        }
        if (!trading && positionAmt == 0) {
            await sleep(100);
        }
    }

})()