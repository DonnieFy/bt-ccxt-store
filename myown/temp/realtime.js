"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const util = require("util");
const path = require("path");
const https = require('https');
const request = require('request');
// const HttpsProxyAgent = require('https-proxy-agent');

const proxy = 'http://127.0.0.1:7890';

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

class MyExchange {

    setMarkets(markets) {
        this._markets = markets;
    }

    fetchOHLCV(symbol, timeframe, since, limit) {
        return new Promise((resolve, reject) => {
            let id = this._markets[symbol]['id'];
            let url = `https://fapi.binance.com/fapi/v1/klines?interval=${timeframe}&limit=${limit}&symbol=${id}&startTime=${since}`;
            request({
                url: url,
                // proxy: proxy
            }, function (error, response, body) {
                if (error) {
                    return reject(error);
                }
                try {
                    let ohlcvs = JSON.parse(body);
                    if (DEBUGGER || !ohlcvs.length) {
                        LOGGER.log(url);
                        LOGGER.log(body);
                    }
                    resolve(ohlcvs);
                }
                catch (e) {
                    LOGGER.log(body);
                    reject(e);
                }
            });
        })
    }

    fetchOrderBook(symbol, limit) {
        return new Promise((resolve, reject) => {
            let id = this._markets[symbol]['id'];
            let url = `https://fapi.binance.com/fapi/v1/depth?symbol=${id}&limit=${limit}`;
            request({
                url: url,
                // proxy: proxy
            }, function (error, response, body) {
                if (error) {
                    return reject(error);
                }
                try {
                    let orderbook = JSON.parse(body);
                    if (DEBUGGER || !orderbook.asks || !orderbook.bids) {
                        LOGGER.log(url);
                        LOGGER.log(body);
                    }
                    resolve(orderbook);
                }
                catch (e) {
                    LOGGER.log(body);
                    reject(e);
                }
            });
        })
    }
}

const LOGGER = new MyLogger("realtime.log");
const DEBUGGER = false;
const PERIOD_15M = 1000 * 60 * 15;
const PERIOD_10M = 1000 * 60 * 10;

let content = fs.readFileSync(path.join(__dirname, "../params.json"));
let params = JSON.parse(content);

// const httpsAgent = new HttpsProxyAgent("http://127.0.0.1:7890");
const agent = https.Agent({
    keepAlive: true
});
const exchange = new ccxt.binance({
    'apiKey': params["binance"]["apikey"],
    'secret': params["binance"]["secret"],
    'options': {
        'defaultType': 'future'
    },
    "agent": agent
});
const myExchange = new MyExchange();

class MyData {

    constructor(args) {
        this._symbol = args.symbol
        this._leverage = args.leverage
        this._minAmount = args.minAmount;
        this._maxAmount = 0;

        this._last_ts = 0
        this._data = []
        this._open = []
        this._high = []
        this._low = []
        this._close = []
        this._volume = []

        this._sma_20 = [];
        this._sma_80 = [];
        this._avg = [];
        this._agree = [];
        this._vol = [];
        this._pnt = [];

        this._hasError = false;
    }

    getName() {
        return this._symbol;
    }

    hasError() {
        return this._hasError;
    }

    getLeverage() {
        return this._leverage;
    }

    getMinAmount() {
        return this._minAmount;
    }

    getMaxAmount() {
        return this._maxAmount;
    }

    fetchMaxAmount() {
        return myExchange.fetchOrderBook(this._symbol, 5).then(orderbook => {
            let maxSize = 0;
            maxSize += orderbook.asks.slice(0, 5).reduce(function (mem, ask) {
                return mem + parseFloat(ask[1]);
            }, 0);
            maxSize += orderbook.bids.slice(0, 5).reduce(function (mem, bid) {
                return mem + parseFloat(bid[1]);
            }, 0);
            if (DEBUGGER) {
                console.log('symbol %s, maxSize %s', this._symbol, maxSize);
            }

            return this._maxAmount = maxSize
        })
    }

    fetchData() {
        let since = this._last_ts > 0 ? this._last_ts - PERIOD_15M * 1 : exchange.milliseconds() - PERIOD_15M * 120;
        let limit = parseInt((exchange.milliseconds() - since) / PERIOD_15M) + 1;
        return myExchange.fetchOHLCV(this._symbol, '15m', since, limit).then(data => {
            if (DEBUGGER && data) {
                LOGGER.log(data);
            }
            data = data.sort((a, b) => a[0] - b[0]);

            if (data.length == 0) {
                LOGGER.log("error: %s, since: %s, limit: %s", this._symbol, since, limit);
                this._hasError = true;
                return;
            }
            this._hasError = false;

            // 丢掉当前期的数据
            if (parseInt(new Date(data[data.length - 1][0]).getMinutes() / 15) == parseInt(new Date(exchange.milliseconds()).getMinutes() / 15)) {
                data.pop();
            }
            data.forEach(ohlcv => {
                if (!ohlcv.length) {
                    return;
                }
                let tstamp = ohlcv[0]
                if (tstamp > this._last_ts) {
                    if (DEBUGGER) {
                        LOGGER.log(`Data: ${this._symbol}, Adding: ${ohlcv}`);
                    }
                    let open = parseFloat(ohlcv[1]);
                    let high = parseFloat(ohlcv[2]);
                    let low = parseFloat(ohlcv[3]);
                    let close = parseFloat(ohlcv[4]);
                    let volume = parseFloat(ohlcv[5]);

                    this._open.push(open);
                    this._high.push(high);
                    this._low.push(low);
                    this._close.push(close);
                    this._volume.push(volume);
                    this._data.push([tstamp, open, high, low, close, volume]);
                    this._last_ts = tstamp;

                    this._calcPnt();
                    this._calcAgree();
                    this._calcAvg();
                    this._calcVol();
                    this._calcSma_20();
                    this._calcSma_80();
                }
            });

            // 只保留最近1000行，避免内存膨胀
            if (this._data.length > 1000) {
                let start = this._data.length - 1000;
                this._data = this._data.slice(start);
                this._open = this._open.slice(start);
                this._high = this._high.slice(start);
                this._low = this._low.slice(start);
                this._close = this._close.slice(start);
                this._volume = this._volume.slice(start);

                this._sma_20 = this._sma_20.slice(start);
                this._sma_80 = this._sma_80.slice(start);
                this._avg = this._avg.slice(start);
                this._agree = this._agree.slice(start);
                this._vol = this._vol.slice(start);
                this._pnt = this._pnt.slice(start);
            }
        })
    }

    getLastTs() {
        return this._last_ts;
    }

    getTimestamp(offset) {
        let index = this._data.length - 1 - offset;
        return this._data[index][0];
    }

    getOpen(offset) {
        let index = this._data.length - 1 - offset;
        return this._open[index];
    }

    getClose(offset) {
        let index = this._close.length - 1 - offset;
        return this._close[index];
    }

    getPnt(offset) {
        let index = this._data.length - offset - 1;
        return this._pnt[index];
    }

    _calcPnt() {
        let lastIndex = this._data.length - 1;
        this._pnt.push((this._close[lastIndex] - this._open[lastIndex]) / this._open[lastIndex]);
    }

    getVol(offset) {
        let lastIndex = this._close.length - 1 - offset;
        return this._vol[lastIndex];
    }

    _calcVol() {
        let lastIndex = this._close.length - 1;
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            let index = lastIndex - i;
            if (index < 0) {
                break;
            }
            sum += this._volume[index];
        }
        this._vol.push(this._volume[lastIndex] * 7 / sum);
    }

    getAgree(offset) {
        let lastIndex = this._close.length - 1 - offset;
        return this._agree[lastIndex];
    }

    _calcAgree() {
        let index = this._data.length - 1;
        this._agree.push((this._close[index] - this._open[index]) / (this._high[index] - this._low[index]));
    }

    getAvg(offset) {
        let index = this._data.length - 1 - offset;
        return this._avg[index];
    }

    _calcAvg() {
        let lastIndex = this._close.length - 1;
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            let index = lastIndex - i;
            if (index < 0) {
                break;
            }
            sum += Math.abs(this._pnt[index]);
        }
        this._avg.push(this._pnt[lastIndex] * 7 / sum);
    }

    getSma_20(offset) {
        let lastIndex = this._close.length - 1 - offset;
        return this._sma_20[lastIndex];
    }

    getSma_80(offset) {
        let lastIndex = this._close.length - 1 - offset;
        return this._sma_80[lastIndex];
    }

    _calcSma_20() {
        let lastIndex = this._close.length - 1;
        let sum = 0;
        for (let i = 0; i < 20; i++) {
            let index = lastIndex - i;
            if (index < 0) {
                break;
            }
            sum += this._close[index];
        }
        this._sma_20.push(sum / 20);
    }

    _calcSma_80() {
        let lastIndex = this._close.length - 1;
        let sum = 0;
        for (let i = 0; i < 80; i++) {
            let index = lastIndex - i;
            if (index < 0) {
                break;
            }
            sum += this._close[index];
        }
        this._sma_80.push(sum / 80);
    }
}

class MyBroker {

    constructor(args) {
        this._dataMap = args.dataMap;

        this._winTimes = 0;
        this._loseTimes = 0;
        this._stopLossTimes = 0;
        this._allProfit = 0;
        this._allLoss = 0;

        this._typeProfit = {};
        this._typeProfitTimes = {};
        this._typeProfitMax = {};
        this._typeLoss = {};
        this._typeLossTimes = {};
        this._typeLossMax = {};
        this._typeStopLossTimes = {};

        this._symbol_trades = {};
        this._symbol_sizes = {};
        this._position_trades = new Set();
    }

    getSize(symbol) {
        return exchange.fetch_positions([symbol]).then(positions => {
            let info = positions[0].info;
            return parseFloat(info.positionAmt);
        });
    }

    getPositionTrades() {
        return Array.from(this._position_trades);
    }

    openPosition(trade) {
        let data = trade['data'];
        let side = trade['side'];
        let size = trade['size'];
        let posType = trade['posType'];
        let price = data.getClose(0);
        let symbol = data.getName();

        let pos_size = this._symbol_sizes[symbol] || 0;
        let promise = null;

        if (side == 'buy' && pos_size < 0 || side == 'sell' && pos_size > 0) {
            // 仓位已存在，方向相反，直接反向建仓，同时取消掉所有止损单
            let stopLossOrderIds = []
            Array.from(this._symbol_trades[symbol]).forEach(trade => {
                LOGGER.log('SIDE CHANGED, info: %s', JSON.stringify(trade));
                stopLossOrderIds.push(trade['stopLossOrderId']);
                this._position_trades.delete(trade);
            });
            this._symbol_trades[symbol] = new Set();
            this._symbol_sizes[symbol] = 0;

            LOGGER.log('SIDE CHANGED, symbol：%s, origin size: %s', symbol, pos_size);
            promise = exchange.cancelAllOrders(symbol).then(_ => {
                return exchange.createMarketOrder(symbol, side, size + Math.abs(pos_size));
            })
        }
        else {
            promise = exchange.createMarketOrder(symbol, side, size);
        }

        LOGGER.log('symbol：%s, side: %s, price: %s, size: %s, type: %s', symbol, side, price, size, posType);
        return promise.then(order => {
            if (!order) {
                trade['missed'] = true;
                LOGGER.log('ORDER MISSED, symbol：%s', symbol);
                return;
            }
            let stopLossSide = side == 'buy' ? 'sell' : 'buy';
            let stopLoss = trade['stopLoss'];
            if (!this._symbol_trades[symbol]) {
                this._symbol_trades[symbol] = new Set();
                this._symbol_sizes[symbol] = 0;
            }
            this._position_trades.add(trade);
            this._symbol_trades[symbol].add(trade);
            this._symbol_sizes[symbol] += (side == 'buy' ? size : -size);

            return exchange.createMarketOrder(symbol, stopLossSide, size, price ,{ 'stopPrice': stopLoss }).then(stopLossOrder => {
                trade['stopLossOrderId'] = stopLossOrder.id;
            });
        })
    }

    removeTrade(trade) {
        let symbol = trade['data'].getName();
        let side = trade['side'];
        let size = trade['size'];

        this._position_trades.delete(trade);
        this._symbol_trades[symbol].delete(trade);
        this._symbol_sizes[symbol] += (side == 'buy' ? -size : size);
    }

    stopLoss(symbol, posType) {
        if (this._typeStopLossTimes[posType] == undefined) {
            this._typeStopLossTimes[posType] = 0;
        }
        this._typeStopLossTimes[posType]++;
        this._stopLossTimes++
        LOGGER.log('STOP LOSS, symbol: %s, position type: %s', symbol, posType);
    }

    logProfitLoss(symbol, orderId, positionType) {
        return exchange.fetchMyTrades(symbol).then(trades => {
            let pnl = trades.reduce(function (mem, trade) {
                if (trade.info.orderId == orderId) {
                    mem += parseFloat(trade.info.realizedPnl) - 2 * trade.fee.cost;
                }
                return mem;
            }, 0);
            LOGGER.log('OPERATION PROFIT, symbol: %s, pnl: %s', symbol, pnl);

            if (this._typeProfitTimes[positionType] == undefined) {
                this._typeProfit[positionType] = 0;
                this._typeProfitMax[positionType] = 0;
                this._typeProfitTimes[positionType] = 0;
            }
            if (this._typeLossTimes[positionType] == undefined) {
                this._typeLoss[positionType] = 0;
                this._typeLossMax[positionType] = 0;
                this._typeLossTimes[positionType] = 0;
            }
            if (pnl > 0) {
                this._winTimes++;
                this._allProfit += pnl;
                this._typeProfit[positionType] += pnl;
                this._typeProfitTimes[positionType]++;
                this._typeProfitMax[positionType] = Math.max(pnl, this._typeProfitMax[positionType]);
            }
            else {
                this._loseTimes++;
                this._allLoss += pnl;
                this._typeLoss[positionType] += pnl;
                this._typeLossTimes[positionType]++;
                this._typeLossMax[positionType] = Math.min(pnl, this._typeLossMax[positionType]);
            }
        });
    }

    closePosition(data, openSide, size, trade) {
        let symbol = data.getName();
        let posType = trade['posType'];
        let stopLossOrderId = trade['stopLossOrderId'];
        let promise = null;
        if (openSide == 'sell') {
            promise = exchange.createMarketBuyOrder(symbol, size, { "reduceOnly": true });
        }
        else {
            promise = exchange.createMarketSellOrder(symbol, size, { "reduceOnly": true });
        }
        return promise.then(order => {
            return this.logProfitLoss(symbol, order.id, posType).then(_ => {
                return exchange.cancelOrder(stopLossOrderId, symbol);
            });
        });
    }

    print() {
        LOGGER.log('WinTimes: %s, LoseTimes: %s, StopLossTimes: %s, Profit: %s, Loss: %s', this._winTimes, this._loseTimes, this._stopLossTimes, this._allProfit, this._allLoss);
        Object.keys(this._typeProfit).forEach(name => {
            LOGGER.log('TYPE %s, profit %s, avg profit %s, max profit %s, loss %s, avg loss %s, max loss %s , stop loss times: %s',
                name, this._typeProfit[name], this._typeProfit[name] / this._typeProfitTimes[name], this._typeProfitMax[name],
                this._typeLoss[name], this._typeLoss[name] / this._typeLossTimes[name], this._typeLossMax[name], this._typeStopLossTimes[name])
        })
    }

}

async function sleep(ms) {
    let promise = new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    await promise;
}

; (async () => {

    let markets = await exchange.loadMarkets();
    myExchange.setMarkets(markets);

    let datas = [];
    let dataMap = {};
    let symbols = Object.keys(markets);
    let initPromises = [];

    let topn_ups = [];
    let topn_downs = [];
    let topn_up_avg = 0;
    let topn_down_avg = 0;
    let topn_last_ts = 0;

    symbols.forEach(symbol => {
        let market = markets[symbol];
        if (!market.active || symbol.includes('_')) {
            // TODO 新上市3天内的币不要做，波动太大
            return;
        }

        let promise = exchange.fetchLeverageTiers([symbol]).then(info => {
            let leverage = info[symbol][0]['maxLeverage'];
            if (leverage > 10) {
                leverage = 10;
            }
            let data = new MyData({
                symbol: symbol,
                leverage: leverage,
                minAmount: market.limits.amount.min
            });
            if (DEBUGGER) {
                console.log("leverage: %s, symbol: %s", leverage, symbol);
            }
            // exchange.setLeverage(leverage, symbol);
            // exchange.setMarginMode("cross", symbol);
            datas.push(data);
            dataMap[symbol] = data;
            return data.fetchData();
        });
        initPromises.push(promise);
    });
    await Promise.all(initPromises);
    await Promise.all(datas.map(d => d.fetchMaxAmount()));

    let btc = dataMap['BTC/USDT']
    const broker = new MyBroker({ dataMap });

    const TOPN_PERIOD = 24;

    function calcTopn(period) {
        for (let i = 0; i < period; i++) {
            let offset = period - i;
            let sorted = datas.sort((a, b) => a.getPnt(offset) - b.getPnt(offset));
            let topn_up = sorted.slice(-30).reduce((mem, data) => mem += data.getPnt(offset - 1), 0) / 30;
            let topn_down = sorted.slice(0, 30).reduce((mem, data) => mem += data.getPnt(offset - 1), 0) / 30;

            if (DEBUGGER) {
                LOGGER.log('offset: %s', offset);
                sorted.forEach(d => {
                    LOGGER.log('symbol: %s, pnt: %s, avg: %s, vol: %s, agree: %s',
                        d.getName(), d.getPnt(offset), d.getAvg(offset), d.getVol(offset), d.getAgree(offset));
                });
            }

            topn_ups.push(topn_up);
            topn_downs.push(topn_down);
        }
        topn_ups = topn_ups.slice(-TOPN_PERIOD);
        topn_downs = topn_downs.slice(-TOPN_PERIOD);
        topn_up_avg = topn_ups.reduce((mem, v) => mem += v, 0) / TOPN_PERIOD;
        topn_down_avg = topn_downs.reduce((mem, v) => mem += v, 0) / TOPN_PERIOD;
        topn_last_ts = btc.getLastTs();
        if (DEBUGGER) {
            LOGGER.log('timestamp: %s', topn_last_ts);
            LOGGER.log('topn_ups: %s, avg: %s', topn_ups, topn_up_avg);
            LOGGER.log('topn_downs: %s, avg: %s', topn_downs, topn_down_avg);
        }
    }

    function createPositionTrade(data, side, stopDate, posType, times) {
        let stopLoss = 0;
        if (side == 'buy') {
            stopLoss = data.getClose(0) * 0.97;
        }
        else {
            stopLoss = data.getClose(0) * 1.03;
        }
        return {
            data, side, stopLoss, stopDate, posType, times
        }
    }

    calcTopn(TOPN_PERIOD);

    // 标记上一次计算的时间
    let preQuarter = -1;
    let preMinutes = -1;
    let preHours = -1;
    while (true) {
        try {
            let currentMs = exchange.milliseconds()
            let currentDate = new Date(currentMs);
            let minutes = currentDate.getMinutes();
            let hours = currentDate.getHours();
            let quarter = parseInt(minutes / 15);

            if (quarter == preQuarter) {
                if ((minutes + 1) % 15 == 0 && currentDate.getSeconds() > 45) {
                    // 最后一分钟一直等，确保15分钟第一时间发出请求
                    continue;
                }
                if ((hours % 4 == 0) && preHours != hours) {
                    preHours = hours;
                    broker.print();
                }
                if (preMinutes != minutes && minutes % 7 == 0) {
                    preMinutes = minutes;
                    await Promise.all(datas.map(d => d.fetchMaxAmount()));
                }

                // 处理已有仓位
                let closePromises = [];
                let currentPositionTrades = broker.getPositionTrades();

                for (let i = currentPositionTrades.length - 1; i >= 0; i--) {
                    let trade = currentPositionTrades[i];
                    let d = trade['data'];
                    let openSide = trade['side'];
                    let stopLoss = trade['stopLoss'];
                    let symbol = d.getName();
                    // TODO 需要考虑对同一个标的多次建立仓位的情况，并且还可能存在多空建仓的情况
                    if (exchange.milliseconds() > trade['stopDate'] || (openSide == 'buy' && d.getClose(0) < stopLoss) || (openSide == 'sell' && d.getClose(0) > stopLoss)) {
                        let size = trade['size'];
                        let stopLossOrderId = trade['stopLossOrderId'];

                        closePromises.push(exchange.fetchOrder(stopLossOrderId, symbol).then(order => {
                            if (order.status == "closed") {
                                let positionType = trade['posType'];
                                broker.stopLoss(symbol, positionType);
                                return broker.logProfitLoss(symbol, stopLossOrderId, positionType);
                            }
                            else if (order.status == 'open') {
                                return broker.closePosition(d, openSide, Math.abs(size), trade);
                            }
                        }));

                        broker.removeTrade(trade);
                    }
                }

                await Promise.all(closePromises);

                await sleep(1000);
                continue;
            }

            await Promise.all(datas.map(d => d.fetchData()));

            if (btc.getLastTs() > topn_last_ts) {
                let period = (btc.getLastTs() - topn_last_ts) / PERIOD_15M;
                calcTopn(period);
            }
            preQuarter = quarter;

            let preparePosTrades = [];

            currentMs = exchange.milliseconds()

            for (let i = 0, len = datas.length; i < len; i++) {
                let d = datas[i];
                let symbol = d.getName();
                if (d.hasError()) {
                    continue;
                }
                // long
                if (btc.getSma_20(0) > btc.getSma_80(0) && d.getSma_20(0) > d.getSma_80(0)) {
                    // 多1
                    if (d.getPnt(0) > 0.01 || d.getPnt(0) < -0.01) {
                        let avg_0 = d.getAvg(0);
                        let vol_0 = d.getVol(0);
                        let agree_0 = d.getAgree(0);
                        let pnt_0 = d.getPnt(0);

                        // 涨破
                        if (d.getOpen(0) < d.getSma_20(0) && d.getSma_20(0) < d.getClose(0) &&
                            avg_0 > 3.5 && agree_0 > 0.5 && vol_0 > 1.2 && topn_up_avg > 0.0001) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 7, '多1涨破1', 2))
                        }
                        // 跌破
                        if (d.getOpen(0) > d.getSma_20(0) && d.getSma_20(0) > d.getClose(0) &&
                            agree_0 > -0.5 && vol_0 > 1.2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 7, '多1跌破1', 5))
                        }
                        if (d.getOpen(0) > d.getSma_20(0) && d.getSma_20(0) > d.getClose(0) &&
                            (agree_0 > -0.5 && agree_0 < 0 || agree_0 > 0.1 && agree_0 < 1) && vol_0 < 2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 7, '多1跌破2', 0.5))
                        }
                        // 涨势
                        if (topn_up_avg > 0.0001 && vol_0 > 2.5 && vol_0 < 5 &&
                            avg_0 > 1 && avg_0 < 5 && agree_0 > 0.5 && pnt_0 > 0.03) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 7, '多1涨势1', 2))
                        }
                        if (topn_up_avg > 0.0001 && avg_0 > -3 && avg_0 < -1.6 &&
                            agree_0 > -0.92 && vol_0 > 2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 7, '多1跌势1', 2))
                        }
                    }
                    // 多2
                    if (d.getPnt(1) > 0.01 || d.getPnt(1) < -0.01) {
                        let avg_1 = d.getAvg(0);
                        let vol_1 = d.getVol(0);
                        let agree_1 = d.getAgree(0);
                        let pnt_1 = d.getPnt(0);
                        let avg_0 = d.getAvg(1);
                        let vol_0 = d.getVol(1);
                        let agree_0 = d.getAgree(1);
                        let pnt_0 = d.getPnt(1);

                        // 涨破
                        if (d.getOpen(0) < d.getSma_20(0) && d.getSma_20(0) < d.getClose(0) &&
                            avg_0 > -3 && avg_0 < 0 && agree_0 > -0.83 && vol_1 > 1) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 6, '多2涨破1', 2))
                        }
                        // 跌破
                        if (d.getOpen(0) > d.getSma_20(0) && d.getSma_20(0) > d.getClose(0) &&
                            avg_0 > 1 && avg_0 < 4 && agree_0 > 0.5 && avg_1 < -1) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 6, '多2跌破1', 2))
                        }
                        // 涨势
                        if (topn_up_avg > 0 && avg_0 > 2 && vol_0 < 4 && vol_0 > 2 &&
                            agree_0 > 0.62 && agree_1 > 0.62 && vol_1 < 2 && avg_1 < 3) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 6, '多2涨势1', 2))
                        }
                        if (topn_up_avg > 0.0002 && avg_0 < 0 && avg_0 > -2 && agree_0 > -0.5 &&
                            vol_0 > 1 && vol_0 < 3 && agree_1 < 0.8 && agree_1 > 0 && vol_1 < 1.2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 6, '多2涨势2', 0.5))
                        }
                        // 跌势
                        if (topn_down_avg > 0.0002 && avg_0 < -2 && agree_0 < -0.8 && vol_0 > 1 &&
                            agree_1 < -0.5 && vol_1 > 1.2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 6, '多2跌势1', 2))
                        }
                        if (topn_down_avg > 0.0001 && agree_0 > 0.8 && avg_0 > 2.5 && vol_1 < 2.5 &&
                            agree_1 > -0.5 && agree_1 < 0 && pnt_1 > -pnt_0 && pnt_1 < -pnt_0 * 0.2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 6, '多2跌势2', 1))
                        }
                    }
                    // 多3
                    if (d.getPnt(2) > 0.01 || d.getPnt(2) < -0.01) {
                        let avg_2 = d.getAvg(0);
                        let vol_2 = d.getVol(0);
                        let agree_2 = d.getAgree(0);
                        let pnt_2 = d.getPnt(0);
                        let avg_1 = d.getAvg(1);
                        let vol_1 = d.getVol(1);
                        let agree_1 = d.getAgree(1);
                        let pnt_1 = d.getPnt(1);
                        let avg_0 = d.getAvg(2);
                        let vol_0 = d.getVol(2);
                        let agree_0 = d.getAgree(2);
                        let pnt_0 = d.getPnt(2);

                        // 涨破
                        if (d.getOpen(0) < d.getSma_20(0) && d.getSma_20(0) < d.getClose(0) &&
                            avg_0 > 1 && vol_0 > 1) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3涨破1', 1))
                        }
                        if (d.getOpen(0) < d.getSma_80(0) && d.getSma_80(0) < d.getClose(0) &&
                            topn_down_avg > 0 && pnt_0 < 0 && pnt_1 > 0 &&
                            vol_0 > 1 && avg_2 > 1) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3涨破3', 1))
                        }
                        // 跌破
                        if (d.getOpen(0) > d.getSma_20(0) && d.getSma_20(0) > d.getClose(0) &&
                            vol_2 > 1.5) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3跌破1', 2))
                        }
                        if (d.getOpen(0) > d.getSma_20(0) && d.getSma_20(0) > d.getClose(0) &&
                            pnt_0 > 0 && pnt_1 < 0 && vol_0 < 1.5 && vol_1 < 1.5 &&
                            d.getClose(0) > d.getOpen(2) && vol_2 < 1.5) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3跌破2', 5))
                        }
                        // 涨势
                        if (avg_0 > 3 && vol_0 > 1.5 && agree_0 > 0.5 &&
                            topn_up_avg > 0.0001 && pnt_1 > 0 && pnt_2 > 0 &&
                            (avg_1 > 1 || avg_2 > 1)) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3涨势1', 0.5))
                        }
                        if (topn_up_avg > 0.0001 && pnt_1 < 0 && pnt_2 > 0 &&
                            vol_0 > 1.5 && agree_0 > 0.5 && pnt_0 > 0.03 && vol_1 < 2.5) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3涨势2', 1))
                        }
                        if (topn_down_avg > 0.0001 && pnt_1 < 0 && pnt_2 < 0 &&
                            d.getClose(0) < d.getOpen(2) && (vol_1 > 2 || vol_2 > 2) &&
                            vol_0 > 1.5 && agree_0 > 0.5 && avg_0 > 2 && avg_0 < 4) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3涨势3', 5))
                        }
                        if (topn_up_avg > 0.0005 && pnt_0 > 0.03 && pnt_1 > 0 && pnt_2 < 0 &&
                            avg_2 > -1 && vol_2 < 2 && agree_2 > -0.5) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3涨势4', 2))
                        }
                        // 跌势
                        if (topn_down_avg > 0.0001 && pnt_1 < 0 && pnt_2 < 0 && pnt_0 < 0 &&
                            avg_0 > -3 && vol_1 > 1 && vol_2 > 1) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3跌势1', 5))
                        }
                        if (topn_down_avg > 0 && vol_0 > 2.5 && avg_0 < -3 &&
                            agree_0 < -0.5 && pnt_0 < 0 && (pnt_1 > 0 || pnt_2 > 0) &&
                            d.getClose(0) < d.getOpen(2) && vol_1 < 1.2 && vol_2 < 1.2) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3跌势2', 5))
                        }
                        if (topn_down_avg > 0 && avg_0 > -2 && agree_0 < -0.5 &&
                            pnt_0 < 0 && pnt_1 > 0 && pnt_2 > 0 &&
                            (avg_1 > 1 || avg_2 > 1) && (vol_1 > 1 || vol_2 > 1)) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 5, '多3跌势3', 1))
                        }
                    }
                    // 多4
                    if (d.getPnt(3) > 0.01 || d.getPnt(3) < -0.01) {
                        let avg_3 = d.getAvg(0);
                        let vol_3 = d.getVol(0);
                        let agree_3 = d.getAgree(0);
                        let pnt_3 = d.getPnt(0);
                        let avg_2 = d.getAvg(1);
                        let vol_2 = d.getVol(1);
                        let agree_2 = d.getAgree(1);
                        let pnt_2 = d.getPnt(1);
                        let avg_1 = d.getAvg(2);
                        let vol_1 = d.getVol(2);
                        let agree_1 = d.getAgree(2);
                        let pnt_1 = d.getPnt(2);
                        let avg_0 = d.getAvg(3);
                        let vol_0 = d.getVol(3);
                        let agree_0 = d.getAgree(3);
                        let pnt_0 = d.getPnt(3);
                        // 涨破
                        if (d.getOpen(0) < d.getSma_20(0) && d.getSma_20(0) < d.getClose(0) &&
                            pnt_0 > 0 && pnt_3 > 0 && agree_0 > 0.5) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 4, '多4涨破1', 2))
                        }
                        // 跌破
                        if (d.getOpen(0) > d.getSma_80(0) && d.getSma_80(0) > d.getClose(0) &&
                            pnt_0 > 0 && vol_0 < 2 && avg_0 < 2 && vol_3 < 3) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 4, '多4跌破1', 2))
                        }
                        if (d.getOpen(0) > d.getSma_20(0) && d.getSma_20(0) > d.getClose(0) &&
                            pnt_0 > 0 && agree_0 > 0.7 && (pnt_1 > 0 || pnt_2 > 0) &&
                            agree_3 > -0.5 && vol_3 < 1.5) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 4, '多4跌破2', 5))
                        }
                        // 涨势
                        if (topn_up_avg > 0.0001 && pnt_0 > 0.02 && avg_0 < 4 && avg_0 > 3 &&
                            (pnt_1 > 0 || pnt_2 > 0 || pnt_3 > 0) && d.getClose(0) > d.getClose(3)) {
                            preparePosTrades.push(createPositionTrade(d, 'buy', currentMs + PERIOD_15M * 4, '多4涨势1', 5))
                        }
                    }
                }
                // short
                else if (btc.getSma_20(0) < btc.getSma_80(0) && d.getSma_20(0) < d.getSma_80(0)) {
                    // 空1
                    if (d.getPnt(0) > 0.01 || d.getPnt(0) < -0.01) {
                        let avg_0 = d.getAvg(0);
                        let vol_0 = d.getVol(0);
                        let agree_0 = d.getAgree(0);
                        let pnt_0 = d.getPnt(0);
                        // 涨破
                        if (d.getClose(0) > d.getSma_80(0) && d.getSma_80(0) > d.getOpen(0) &&
                            avg_0 < 0.85 && vol_0 > 3) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空1涨破1', 2))
                        }
                        // 跌破
                        if (d.getClose(0) < d.getSma_80(0) && d.getSma_80(0) < d.getOpen(0) &&
                            avg_0 < -2) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空1跌破1', 1))
                        }
                        // 涨势
                        if (avg_0 > 4 && agree_0 < 0.8 && topn_up_avg < -0.0001) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空1涨势1', 5))
                        }
                        // 跌势
                        if (d.getClose[0] < d.getSma_20(0) && agree_0 > -0.5 && vol_0 < 2 &&
                            agree_0 < -1 && topn_down_avg < -0.0001) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空1跌势1', 2))
                        }
                    }
                    // 空2
                    if (d.getPnt(1) > 0.01 || d.getPnt(1) < -0.01) {
                        let avg_1 = d.getAvg(0);
                        let vol_1 = d.getVol(0);
                        let agree_1 = d.getAgree(0);
                        let pnt_1 = d.getPnt(0);
                        let avg_0 = d.getAvg(1);
                        let vol_0 = d.getVol(1);
                        let agree_0 = d.getAgree(1);
                        let pnt_0 = d.getPnt(1);
                        // 涨破
                        if (d.getClose(0) > d.getSma_80(0) && d.getSma_80(0) > d.getOpen(0) &&
                            agree_1 < 0.8 && vol_1 > 3) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空2涨破1', 2))
                        }
                        // 跌破
                        if (d.getClose(0) < d.getSma_80(0) && d.getSma_80(0) < d.getOpen(0) &&
                            avg_0 > 3) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空2跌破1', 5))
                        }
                        // 涨势
                        if (avg_0 > 3 && vol_0 > 1.8 && avg_1 < 0 && vol_1 < 1.5) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空2涨势1', 2))
                        }
                        // 跌势
                        if (avg_0 < -3 && vol_0 > 2 && agree_0 < -0.85 &&
                            (pnt_1 < -pnt_0 * 0.1 && vol_1 < 2 || agree_1 < 0.2 && vol_1 < 1.5) &&
                            pnt_1 > 0 && topn_down_avg < -0.0001) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空2跌势1', 10))
                        }
                    }
                    // 空3
                    if (d.getPnt(2) > 0.01 || d.getPnt(2) < -0.01) {
                        let avg_2 = d.getAvg(0);
                        let vol_2 = d.getVol(0);
                        let agree_2 = d.getAgree(0);
                        let pnt_2 = d.getPnt(0);
                        let avg_1 = d.getAvg(1);
                        let vol_1 = d.getVol(1);
                        let agree_1 = d.getAgree(1);
                        let pnt_1 = d.getPnt(1);
                        let avg_0 = d.getAvg(2);
                        let vol_0 = d.getVol(2);
                        let agree_0 = d.getAgree(2);
                        let pnt_0 = d.getPnt(2);
                        // 涨破
                        if (d.getClose(0) > d.getSma_80(0) && d.getSma_80(2) > d.getClose(2) &&
                            agree_2 < 0.8 && vol_2 < 2 && pnt_2 > 0 && pnt_0 > 0) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空3涨破1', 1))

                        }
                        // 跌破
                        if (d.getClose(0) < d.getSma_80(0) && d.getSma_80(2) < d.getClose(2) &&
                            avg_0 > 3 && (pnt_1 > 0 && pnt_2 < 0 || pnt_1 < 0 && pnt_2 > 0)) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空3跌破1', 10))
                        }
                        // 涨势
                        if (avg_0 > 3 && vol_0 > 1.5 && vol_1 < 1.5 && avg_1 > -1 && avg_1 < -0.3 &&
                            avg_2 > -1 && avg_2 < -0.3 && vol_2 < 1.5) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空3涨势1', 5))
                        }
                        // 跌势
                        if (avg_0 < -3 && vol_0 > 2 && agree_0 < -0.85 && d.getClose(0) < d.getClose(2) &&
                            (d.getClose(0) - d.getClose(2)) / d.getClose(2) > pnt_0 * 0.68 &&
                            vol_1 < 3 && vol_2 < 3 && topn_down_avg < -0.0001) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空3跌势1', 2))
                        }
                        if (avg_0 < -3 && vol_0 > 2 && agree_0 < -0.85 && d.getClose(0) > d.getClose(2) &&
                            (d.getClose(0) - d.getClose(2)) / d.getClose(2) < -pnt_0 * 0.1 &&
                            vol_1 < 1.8 && vol_2 < 1.8 && topn_up_avg < -0.0001) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空3跌势2', 10))
                        }
                    }
                    // 空4
                    if (d.getPnt(3) > 0.01 || d.getPnt(3) < -0.01) {
                        let avg_3 = d.getAvg(0);
                        let vol_3 = d.getVol(0);
                        let agree_3 = d.getAgree(0);
                        let pnt_3 = d.getPnt(0);
                        let avg_2 = d.getAvg(1);
                        let vol_2 = d.getVol(1);
                        let agree_2 = d.getAgree(1);
                        let pnt_2 = d.getPnt(1);
                        let avg_1 = d.getAvg(2);
                        let vol_1 = d.getVol(2);
                        let agree_1 = d.getAgree(2);
                        let pnt_1 = d.getPnt(2);
                        let avg_0 = d.getAvg(3);
                        let vol_0 = d.getVol(3);
                        let agree_0 = d.getAgree(3);
                        let pnt_0 = d.getPnt(3);
                        // 涨破
                        if (d.getClose(0) > d.getSma_80(0) && d.getSma_80(0) > d.getOpen(0) &&
                            pnt_0 > 0 && agree_3 < 0.8 && vol_3 < 2 && pnt_3 > 0 && avg_3 > 1.2) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空4涨破1', 2))
                        }
                        // 跌破
                        if (d.getClose(0) < d.getSma_80(0) && d.getSma_80(0) < d.getOpen(0) &&
                            avg_0 > 3) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空4跌破1', 2))
                        }
                        // 涨势
                        if (avg_0 > 3 && vol_0 > 1.5 &&
                            (avg_1 > -1 && avg_1 < -0.3 && vol_1 < 1.5 || avg_1 > 2 && agree_1 < 0.8) &&
                            (avg_2 > -1 && avg_2 < -0.3 && vol_2 < 1.5 || avg_2 > 2 && agree_2 < 0.8) &&
                            avg_3 > -1 && avg_3 < -0.3) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空4涨势1', 5))
                        }
                        // 跌势
                        if (avg_0 < -3 && vol_0 > 2 && agree_0 < -0.85 && pnt_1 < 0 && pnt_2 > 0 &&
                            avg_1 > -1.5 && agree_2 < 0.5 && pnt_3 < 0) {
                            preparePosTrades.push(createPositionTrade(d, 'sell', currentMs + PERIOD_15M * 8, '空4跌势1', 10))
                        }
                    }
                }
            }

            let count = preparePosTrades.length;
            if (count > 0) {
                let balance = await exchange.fetchBalance();
                let total_value = balance['total']['USDT'] + balance['total']['BUSD'];
                let cash = balance['free']['USDT'];
                LOGGER.log('账户价值：%s, 现金: %s', total_value, cash);

                let long = btc.getSma_20(0) > btc.getSma_80(0);
                let ratio = parseInt(total_value / 120);
                let base = long ? 12 : 6;
                let minValue = ratio > 0 ? base * ratio : base;
                let maxValue = minValue * 1.5;
                let posValue = cash / count;
                if (posValue < minValue) {
                    posValue = minValue;
                }
                if (posValue > maxValue) {
                    posValue = maxValue;
                }
                if (DEBUGGER) {
                    LOGGER.log('posValue：%s, minValue: %s, maxValue: %s', posValue, minValue, maxValue);
                }

                let promises = []

                preparePosTrades = preparePosTrades.sort((a, b) => b['times'] - a['times']);
                for (let i = 0; i < count; i++) {
                    let value = posValue;
                    let trade = preparePosTrades[i];
                    let d = trade['data'];
                    let symbol = d.getName();
                    let price = d.getClose(0);
                    let size = parseFloat((value / price).toFixed(markets[symbol].precision.amount));

                    // 要比最小仓位大
                    if (size > d.getMaxAmount() && d.getMaxAmount() > 0) {
                        size = d.getMaxAmount();
                    }
                    if (size < d.getMinAmount()) {
                        size = d.getMinAmount();
                    }
                    value = price * size;

                    let costCash = value / d.getLeverage();
                    if (cash < costCash) {
                        LOGGER.log('cash < costCash, cash: %s, costCash: %s', cash, costCash);
                        break;
                    }
                    trade['size'] = size;
                    try {
                        let promise = broker.openPosition(trade);
                        promises.push(promise);
                        cash -= costCash;
                    }
                    catch(e) {
                        LOGGER.log("symbol: %s, error: %s", e);
                    }
                }

                await Promise.all(promises);
            }
        }
        catch (e) {
            LOGGER.log("error: %s", e);
        }
    }


})()