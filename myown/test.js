"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const HttpsProxyAgent = require('https-proxy-agent');
const socks = require('@luminati-io/socksv5')


; (async () => {
    const httpsAgent = new HttpsProxyAgent("http://127.0.0.1:7890");

    const agent = new socks.HttpsAgent ({
        proxyHost: 'ss.succez.com',
        proxyPort: 1086,
        auths: [ socks.auth.None () ]
    })

    const exchange = new ccxt.binance({
        'apiKey': 'NHOkdZV92IY0sIcvdfswkc60SCyJAKTnrbgkHILGDHQW6NXGo87NwzQmBXXFGJSo',
        'secret': 'W9ffpThUt5TLVqOJG2tNZeFyAhiDJqyUK3lX3IgRqBTEpcG2SuHRJFLQyvyCTpK0',
        'agent': httpsAgent,
        'options': {
            'defaultType': 'future'
        }
    });

    var symbol = "AMB/BUSD";

    let markets = await exchange.loadMarkets();
    let market = markets[symbol];
    let amountMin = parseFloat(market.limits.amount.min);
    let amountPrecision = parseInt(market.precision.amount);
    let priceMin = parseFloat(market.limits.price.min);
    let pricePresision = parseInt(market.precision.price);
    let priceGrain = parseFloat(Math.pow(10, 0 - pricePresision).toPrecision());
    console.log(amountMin);
    console.log(pricePresision);
    console.log(priceGrain);

    // let accounts = await exchange.fetchBalance();
    // console.log(accounts["free"]["BTC"]);
    // console.log(accounts["free"]["USDT"]);
    // console.log(accounts["BTC"]);
    // console.log(accounts["USDT"]);


    // // console.log(JSON.stringify(datas));

    // // let trades = await exchange.fetchMyTrades(symbol);
  
    // // orders = orders.reverse();
    // // console.log(JSON.stringify(orders[0]));
    
    // // console.log(JSON.stringify(orders[1]));

    // // let postions = await exchange.fetch_positions([symbol]);
    // // let info = postions[0];
    // // let postionSize = parseFloat(info.positionAmt);

    // // console.log(JSON.stringify(info));
    // var time = exchange.milliseconds();
    // var trades = await exchange.fetchTrades(symbol, time-1000, 100)
    //  for (let i = 0, len = trades.length; i < len; i++) {
    //     console.log("time: %s, amount: %d, price: %d",trades[i].datetime, trades[i].amount, trades[i].price);
    // }
    // console.log(trades.length);
    // const orderbook = await exchange.fetchOrderBook(symbol)
    // console.log(orderbook.asks.length);
    // console.log(orderbook.bids.length);

    // for (let i = 0; i < 10; i++) {
    //     let bid = orderbook.bids[i];
    //     console.log("bid: %d, amount: %d", bid[0], bid[1]);
    // }
    // for (let i = 0; i < 10; i++) {
    //     let ask = orderbook.asks[i];
    //     console.log("ask: %d, amount: %d", ask[0], ask[1]);
    // }

    // var trades = await exchange.fetchTrades(symbol, time - 3000, 1000)
    // console.log(new Date(time - 3000))
    // for (let i = 0, len = trades.length; i < len; i++) {
    //     console.log("time: %s, amount: %d, price: %d",trades[i].datetime, trades[i].amount, trades[i].price);
    // }
    // trades = trades.reverse()
    // var buyCount = 0;
    // var sellCount = 0;
    // var maxPrice = 0;
    // var minPrice = 10;
    // for (let i = 0, len = trades.length; i < len; i++) {
    //     let trade = trades[i];
    //     let date = new Date(trade.timestamp);
    //     date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    //     if (trade.side == 'buy') {
    //         buyCount += trade.amount;
    //     }
    //     else {
    //         sellCount += trade.amount;
    //     }
    //     maxPrice = Math.max(maxPrice, trade.price);
    //     minPrice = Math.min(minPrice, trade.price)
    //     console.log("time: %s, side: %s, price: %d, amount: %d, cost: %d, takerOrMaker: %s", date.toISOString(), trade.side, trade.price, trade.amount, trade.cost, trade.takerOrMaker)
    // }

    // console.log('buy amount: %d, sell amount: %d, max: %d, min: %d', buyCount, sellCount, maxPrice, minPrice);

})()