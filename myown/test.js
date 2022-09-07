"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const HttpsProxyAgent = require('https-proxy-agent');

; (async () => {

    const exchange = new ccxt.binance({
        'apiKey': 'NHOkdZV92IY0sIcvdfswkc60SCyJAKTnrbgkHILGDHQW6NXGo87NwzQmBXXFGJSo',
        'secret': 'W9ffpThUt5TLVqOJG2tNZeFyAhiDJqyUK3lX3IgRqBTEpcG2SuHRJFLQyvyCTpK0',
        'agent': new HttpsProxyAgent("http://127.0.0.1:7890"),
        'options': {
            'defaultType': 'future'
        }
    });

    var symbol = "1000LUNC/BUSD";

    const orderbook = await exchange.fetchOrderBook(symbol)
    for (let i = 0; i < 10; i++) {
        let bid = orderbook.bids[i];
        console.log("bid: %d, amount: %d", bid[0], bid[1]);
    }
    for (let i = 0; i < 10; i++) {
        let ask = orderbook.asks[i];
        console.log("ask: %d, amount: %d", ask[0], ask[1]);
    }

    var date = new Date();
    date.setSeconds(-1);

    var trades = await exchange.fetchTrades(symbol, date.getTime(), 1000)
    trades = trades.reverse()
    for (let i = 0; i < 30; i++) {
        let trade = trades[i];
        let date = new Date(trade.timestamp);
        console.log("time: %s, side: %s, price: %d, amount: %d, cost: %d, takerOrMaker: %s", date.toISOString(), trade.side, trade.price, trade.amount, trade.cost, trade.takerOrMaker)
    }

})()