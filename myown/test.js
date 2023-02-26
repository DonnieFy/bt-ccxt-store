"use strict";

const ccxt = require("ccxt");
const fs = require("fs");
const HttpsProxyAgent = require('https-proxy-agent');
const socks = require('@luminati-io/socksv5')
const url = require('url');
const https = require('https');
const request = require('request');
const crypto = require('crypto')


    ; (async () => {
        const proxy = 'http://127.0.0.1:7890';

        let options = url.parse(proxy);

        const httpsAgent = new HttpsProxyAgent(options);
        httpsAgent.maxFreeSockets = 1000;
        let callback = httpsAgent.callback;
        httpsAgent.callback = function () {
            console.log(arguments[0].path)
            return callback.apply(httpsAgent, arguments);
        }

        const agent = new socks.HttpsAgent({
            proxyHost: 'ss.succez.com',
            proxyPort: 1086,
            auths: [socks.auth.None()]
        })

        let content = fs.readFileSync(path.join(__dirname, "../params.json"));
        let params = JSON.parse(content);

        const secret = params["binance"]["secret"];
        const apiKey = params["binance"]["apikey"];

        const exchange = new ccxt.binance({
            'apiKey': apiKey,
            'secret': secret,
            'agent': httpsAgent,
            'options': {
                'defaultType': 'future'
            }
        });

        let markets = await exchange.loadMarkets();
        console.log(markets["BTC/USDT"])
        // await exchange.fetchOrders("BTC/USDT")

        // await exchange.fetchMyTrades("BTC/USDT")

        // await exchange.fetch_positions(["BTC/USDT"])

        // await exchange.fetchOrderBook("BTC/USDT", 10)

        // await exchange.createLimitSellOrder("BTC/USDT", 0, 0)

        // let markets = await exchange.loadMarkets();
        // let symbols = Object.keys(markets);
        // let since = exchange.milliseconds() - 1000 * 60 * 15;

        // console.log(markets['BTC/USDT']['id'])

        // // console.log('[' + new Date().toISOString() +'] start');
        // await Promise.all(symbols.map(symbol => exchange.fetchOHLCV(symbol, '15m', since, 2).then(data=>{
        //     // console.log('[' + new Date().toISOString() +']' + symbol);
        // })));
        // // console.log('[' + new Date().toISOString() +'] end');


        // console.log('[' + new Date().toISOString() +'] start');
        // // for (const symbol of symbols) {
        // //     let data = await exchange.fetchOHLCV(symbol, '15m', since, 2);
        // //     console.log('[' + new Date().toISOString() +']' + symbol);
        // // }
        // await Promise.all(symbols.map(symbol => fetch_ohlcv(symbol).then(data=>{
        //     console.log('[' + new Date().toISOString() +']' + symbol + ', data:' + data);
        // })));

        // // symbols.forEach(symbol => {
        // //     symbol = symbol.replace('/', '')
        // //     let url = `https://fapi.binance.com/fapi/v1/klines?interval=15m&limit=2&symbol=${symbol}&startTime=1675424639575`;
        // //     // https.request(url, {
        // //     //     'agent' : httpsAgent
        // //     // }, function() {
        // //     //     console.log('[' + new Date().toISOString() +']' + symbol);
        // //     // })
        // //     request({
        // //         url: url,
        // //         proxy: proxy
        // //     }, function (error, response, body) {
        // //         console.log('[' + new Date().toISOString() +']' + body);
        // //     });
        // // })

        // console.log('[' + new Date().toISOString() +'] end');

        function sign(query_string) {
            return crypto
                .createHmac('sha256', secret)
                .update(query_string)
                .digest('hex');
        }
        
        const assignDefaultParams = function (params) {
            params.recvWindow = 3000;
            params.timestamp = Date.now();
        }

        const makeQueryString = function (json) {
            return `${Object.keys(json)
                .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(json[k])}`)
                .join('&')}`
        }

        const privateCall = function (baseUrl, method, params) {
            assignDefaultParams(params);
            let signature = sign(makeQueryString(params));
            let url = baseUrl + '?' + makeQueryString({ ...params, signature });

        //    console.log(url);
            return new Promise((resolve, reject) => {
                request({
                    url: url,
                    headers: {
                        'content-type': 'application/json',
                        'X-MBX-APIKEY': apiKey,
                    },
                    method: method,
                    proxy: proxy
                }, function (error, response, body) {
                    if (error) {
                        return reject(error);
                    }
                    let data = JSON.parse(body);
                    resolve(data);
                });

            });
        }

        function fetch_positions(symbol) {
            let data = { symbol };
            return privateCall('https://fapi.binance.com/fapi/v2/positionRisk', 'GET', data)
        }

        function fetchOrder(orderId, symbol) {
            let data = { symbol, orderId };
            return privateCall('https://fapi.binance.com/fapi/v1/order', 'GET', data)
        }

        function cancelOrder(orderId, symbol) {
            let data = { symbol, orderId };
            return privateCall('https://fapi.binance.com/fapi/v1/order', 'DELETE', data)
        }

        function cancelAllOrders(symbol) {
            let data = { symbol };
            return privateCall('https://fapi.binance.com/fapi/v1/allOpenOrders', 'DELETE', data)
        }

        function fetchMyTrades(symbol, startTime) {
            let data = { symbol, startTime };
            return privateCall('https://fapi.binance.com/fapi/v1/userTrades', 'GET', data)
        }

        function createBatchOrders(orders) {
            let data = { batchOrders: JSON.stringify(orders) };
            return privateCall('https://fapi.binance.com/fapi/v1/batchOrders', 'POST', data)
        }

        /**
         * 
         * @param {*} symbol 
         * @param {*} type LIMIT, MARKET, STOP, TAKE_PROFIT, STOP_MARKET, TAKE_PROFIT_MARKET, TRAILING_STOP_MARKET
         * @param {*} side 
         * @param {*} quantity 
         * @param {*} price 
         * @param {*} params reduceOnly,stopPrice,workingType(MARK_PRICE, CONTRACT_PRICE)
         * @returns 
         */
        function createOrder(symbol, type, side, quantity, price, params) {
            params = params || {};
            let data = { symbol, type, side, timeInForce: "GTC", quantity, price, ...params };
            return privateCall('https://fapi.binance.com/fapi/v1/order', 'POST', data)
        }


        function fetch_ohlcv(symbol) {
            return new Promise((resolve, reject) => {
                let url = `https://fapi.binance.com/fapi/v1/klines?interval=15m&limit=2&symbol=${symbol}&startTime=1675424639575`;
                request({
                    url: url,
                    proxy: proxy
                }, function (error, response, body) {
                    if (error) {
                        return reject(error);
                    }
                    let ohlcvs = JSON.parse(body);
                    resolve(ohlcvs);
                });
            })
        }

        let data = await fetch_ohlcv("BTCUSDT");

        function fetchBalance() {
            let t = exchange.milliseconds()
            let w = 10000
            let signature = crypto
                .createHmac('sha256', secret)
                .update('type=future')
                .digest('hex')

            let url = `https://fapi.binance.com/fapi/v1/positionRisk?timestamp=${t}&recvWindow=${w}&signature=${signature}`
            return new Promise((resolve, reject) => {
                request(url, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-MBX-APIKEY': apiKey,
                    },
                    proxy: proxy
                }, function (error, response, body) {
                    if (error) {
                        return reject(error);
                    }
                    let ohlcvs = JSON.parse(body);
                    resolve(ohlcvs);
                });
            })
        }

        let symbol = 'BTCUSDT'

        let res = await createOrder(symbol, 'LIMIT', 'BUY', 0.001, 23000);
        console.log(JSON.stringify(res));
        let orderId = res.orderId;

        res = await createBatchOrders([{
            symbol, type: "LIMIT", side: "BUY", quantity: '0.001', price: '22999', timeInForce: "GTC"
        }])
        console.log(JSON.stringify(res));

        res = await fetchOrder(orderId, symbol);
        console.log(JSON.stringify(res));

        res = await fetch_positions('OGNUSDT')
        console.log(JSON.stringify(res));

        res = await cancelOrder(orderId, symbol);
        console.log(JSON.stringify(res));

        res = await cancelAllOrders(symbol);
        console.log(JSON.stringify(res));

        res = await fetchMyTrades('RNDRUSDT', exchange.milliseconds() - 1000 * 60 * 60);
        console.log(JSON.stringify(res));
        

        // let balance = await fetchBalance();
        // console.log(balance);

        /*    let market = markets[symbol];
           let amountMin = parseFloat(market.limits.amount.min);
           let amountPrecision = parseInt(market.precision.amount);
           let priceMin = parseFloat(market.limits.price.min);
           let pricePresision = parseInt(market.precision.price);
           let priceGrain = parseFloat(Math.pow(10, 0 - pricePresision).toPrecision());
           console.log(amountMin);
           console.log(pricePresision);
           console.log(priceGrain); */

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

        // console.log(JSON.stringify(info));
        /*   var time = exchange.milliseconds();
          var trades = await exchange.fetchTrades(symbol, time-1000, 10)
           for (let i = 0, len = trades.length; i < len; i++) {
              console.log("time: %s, amount: %d, price: %d",trades[i].datetime, trades[i].amount, trades[i].price);
          } */
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
        // var time = exchange.milliseconds();
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