import json
import logging
from datetime import datetime, timedelta
import pytz
import ccxt
from collections import deque
import time


class MyLogger:

    def __init__(self):
        self.logger = logging.getLogger()
        self.logger.setLevel(logging.INFO)
        handler = logging.FileHandler('livetrade.log', encoding='UTF-8')
        handler.setLevel(logging.INFO)
        self.logger.addHandler(handler)

    def log(self, txt):
        dt = datetime.now(tz=pytz.timezone('Asia/Shanghai'))
        msg = '%s, %s' % (dt.isoformat(), txt)
        self.logger.info(msg)
        print(msg)


class MyData:

    def __init__(self, symbol, exchange, logger, debug=False):
        self.symbol = symbol
        self.exchange = exchange
        self.logger = logger
        self.debug = debug
        self._pnt_15 = [0] * 3
        self._pnt_30 = [0] * 3
        self._last_ts = 0
        self._data = []
        self._final_close = None

    def name(self):
        return self.symbol

    def price(self):
        return self._final_close

    def need_buy(self):
        filters = []
        for i in range(3):
            pnt_15 = self._pnt_15[i]
            pnt_30 = self._pnt_30[i]
            if 0.04 <= pnt_15 <= 0.08:
                pnt_15
            elif 0.04 <= pnt_30 <= 0.08:
                filters.append(pnt_30)
        res = len(filters) == 3
        if res:
            self.logger.log('symbol: {}, pnt_15: {}'.format(self.symbol, self._pnt_15))
            self.logger.log('symbol: {}, pnt_30: {}'.format(self.symbol, self._pnt_30))

        return res

    def fetch_data(self, since=None):
        if since is None:
            fromdate = datetime.utcnow() - timedelta(minutes=60)
            since = self._last_ts if self._last_ts > 0 else int((fromdate - datetime(1970, 1, 1)).total_seconds() * 1000)
        if self.debug:
            self.logger.log('Fetching: {}, TF: {}, Since: {}, Limit: {}'.format(self.symbol, '1m', since, 1000))
        data = sorted(self.exchange.fetch_ohlcv(self.symbol, timeframe='1m', since=since, limit=1000))
        if len(data) > 0:
            data.pop()  # 总是把最后一分钟的去掉，等下一分钟再算，避免闪烁
        for ohlcv in data:
            if None in ohlcv:
                continue
            tstamp = ohlcv[0]

            # Prevent from loading incomplete data
            # if tstamp > (time.time() * 1000):
            #    continue

            if tstamp > self._last_ts:
                self._data.append(ohlcv)
                self._last_ts = tstamp

        count = len(self._data)
        if count > 33:
            for i in range(3):
                end_index = count - i - 1
                ohlcv0 = self._load_ohlcv(self._data[end_index])
                ohlcv1 = self._load_ohlcv(self._data[end_index - 15])
                ohlcv2 = self._load_ohlcv(self._data[end_index - 30])
                self._pnt_30[i] = (ohlcv0['close'] - ohlcv2['close']) / ohlcv2['close']
                self._pnt_15[i] = (ohlcv0['close'] - ohlcv1['close']) / ohlcv1['close']
            self._data = self._data[count-60:]
            self._final_close = self._data[len(self._data) - 1][4]
        
        if self.debug:
            self.logger.log('Fetching: {}, 15: {}, 30: {}'.format(self.symbol, self._pnt_15, self._pnt_30))

    def _load_ohlcv(self, ohlcv):
        data = dict()
        tstamp, open_, high, low, close, volume = ohlcv
        data['datetime'] = tstamp
        data['open'] = open_
        data['high'] = high
        data['low'] = low
        data['close'] = close
        data['volume'] = volume
        return data


class MyBTC:

    def __init__(self, symbol, exchange, logger, debug=False):
        self.symbol = symbol
        self.exchange = exchange
        self.logger = logger
        self.debug = debug
        self._data = []
        self._last_ts = 0
        self.sma = None
        self.final_close = None

    def long(self):
        if self.debug:
            self.logger.log('btc close: {}, sma: {}'.format(self.final_close, self.sma))
        return self.final_close > self.sma

    def fetch_data(self):
        fromdate = datetime.utcnow() - timedelta(minutes=1500)
        since = int((fromdate - datetime(1970, 1, 1)).total_seconds() * 1000)
        if self.debug:
            self.logger.log('Fetching: {}, TF: {}, Since: {}, Limit: {}'.format(self.symbol, '15m', since, 1000))
        data = sorted(self.exchange.fetch_ohlcv(self.symbol, timeframe='15m', since=since, limit=1000))
        data.pop()  # 总是把最后一分钟的去掉，等下一分钟再算，避免闪烁
        for ohlcv in data:
            if None in ohlcv:
                continue
            tstamp = ohlcv[0]
            if tstamp > self._last_ts:
                self._data.append(ohlcv)
                self._last_ts = tstamp

        count = len(self._data)
        if count > 80:
            self._data = self._data[count-80:]
        close_sum = 0
        for ohlcv in self._data:
            close_sum += ohlcv[4]
        self.sma = close_sum/80
        self.final_close = self._data[79][4]


class MyBroker:

    def __init__(self, exchange, logger):
        self.exchange = exchange
        self.logger = logger
        self.position_datas = set()
        self.position_dates = dict()
        self.position_prices = dict()
        self.position_sizes = dict()

    def hold(self, data):
        return data in self.position_datas

    def holds(self):
        return self.position_datas

    def get_size(self, name):
        return self.position_sizes[name]

    def get_date(self, name):
        return self.position_dates[name]

    def get_price(self, name):
        return self.position_prices[name]

    def open_buy(self, data, size, exectype, date):
        name = data.name()
        self._submit(symbol=name, exectype=exectype, side='buy', amount=size, price=data.price())
        self.position_dates[name] = date
        self.position_prices[name] = data.price()
        self.position_sizes[name] = size
        self.position_datas.add(data)

    def open_sell(self, data, size, exectype, date):
        name = data.name()
        self._submit(symbol=name, exectype=exectype, side='sell', amount=size, price=data.price())
        self.position_dates[name] = date
        self.position_prices[name] = data.close[0]
        self.position_sizes[name] = size
        self.position_datas.add(data)

    # 关闭一个卖空
    def close_buy(self, data, size, exectype):
        name = data.name()
        orderid = self._submit(symbol=name, exectype=exectype, side='buy', amount=size, price=data.price())
        self.position_dates[name] = None
        self.position_prices[name] = None
        self.position_sizes[name] = None
        self.position_datas.remove(data)
        profit = self.get_profit(name=name, order_id=orderid)
        self.logger.log('OPERATION PROFIT, symbol: {}, pnl: {}'.format(name, profit))

    # 关闭一个做多
    def close_sell(self, data, size, exectype):
        name = data.name()
        orderid = self._submit(symbol=name, exectype=exectype, side='sell', amount=size, price=data.price())
        self.position_dates[name] = None
        self.position_prices[name] = None
        self.position_sizes[name] = None
        self.position_datas.remove(data)
        profit = self.get_profit(name=name, order_id=orderid)
        self.logger.log('OPERATION PROFIT, symbol: {}, pnl: {}'.format(name, profit))

    def _submit(self, symbol, exectype, side, amount, price):
        ret_ord = self.exchange.create_order(symbol=symbol, type=exectype, side=side, amount=amount, price=price)
        order = self.exchange.fetch_order(ret_ord['id'], symbol)
        self.logger.log('symbol: {}, side: {}, price: {}, size: {}'.format(symbol, side, price, amount))
        return ret_ord['id']

    def get_value(self, currency='USDT'):
        balance = self.exchange.fetch_balance()
        return balance['total'][currency]

    def get_profit(self, name, order_id):
        profit = 0
        for trade in self.exchange.fetch_my_trades(name):
            if trade['info']['orderId'] == order_id:
                profit += trade['info']['realizedPnl']
        return profit


def main(debug=False):
    logger = MyLogger()
    logger.log('init')
    with open('../params.json', 'r') as f:
        params = json.load(f)

    config = {
        'apiKey': params["binance"]["apikey"],
        'secret': params["binance"]["secret"],
        'enableRateLimit': True,
        'options': {
            'defaultType': 'future'
        }
    }

    logger.log('start')

    datas = dict()
    exchange = ccxt.binance(config)
    response = exchange.fapiPrivate_get_positionside_dual()
    if response['dualSidePosition']:
        exchange.fapiPrivate_post_positionside_dual({'dualSidePosition': False})
    markets = exchange.load_markets()

    btc = MyBTC(symbol='BTC/USDT', exchange=exchange, logger=logger, debug=debug)
    for market in markets:
        if '_' in market:
            continue
        if market not in datas:
            datas[market] = MyData(symbol=market, exchange=exchange, logger=logger, debug=debug)
            exchange.set_leverage(leverage=10, symbol=market)
    broker = MyBroker(exchange=exchange, logger=logger)

    logger.log('loop')

    while True:
        busd_buys = []
        usdt_buys = []
        buys = []

        btc.fetch_data()
        long = btc.long()
        for market in datas:
            data = datas[market]
            data.fetch_data()
            if broker.hold(data):
                continue
            if long:
                if data.need_buy():
                    buys.append(data)
                    if 'BUSD' in data.name():
                        busd_buys.append(data)
                    else:
                        usdt_buys.append(data)

        total_value_usdt = broker.get_value('USDT')
        total_value_busd = broker.get_value('BUSD')
        if len(busd_buys) > 0 or len(usdt_buys) > 0:
            logger.log([x.name() for x in buys])
            logger.log('total value usdt：%s' % (total_value_usdt,))
            logger.log('total value busd：%s' % (total_value_busd,))

        current_date = datetime.utcnow()

        for d in set(broker.holds()):
            name = d.name()
            size = broker.get_size(name=name)
            interval = (current_date - broker.get_date(name)).seconds / 60
            if size > 0:
                if interval >= 45 or d.price() <= broker.get_price(name) * 0.93:
                    broker.close_sell(data=d, size=size, exectype='Market')
            else:
                if interval >= 45 or d.price() >= broker.get_price(name) * 1.07:
                    broker.close_buy(data=d, size=size, exectype='Market')

        count_usdt = 10
        count_busd = 5
        
        holds = broker.holds()
        for d in holds:
            if 'BUSD' in d.name():
                count_busd -= 1
            else:
                count_usdt -= 1
        ratio_usdt = total_value_usdt // 100
        ratio_busd = total_value_busd // 100
        total_value_usdt = 10 * ratio_usdt if ratio_usdt > 0 else 10
        total_value_busd = 10 * ratio_busd if ratio_busd > 0 else 10
        
        if count_usdt < 0:
            count_usdt = 0
        if count_busd < 0:
            count_busd = 0

        usdt_buys = usdt_buys[:count_usdt] if len(usdt_buys) > count_usdt else usdt_buys
        for d in usdt_buys:
            ss = (total_value_usdt / d.price()) * 10
            broker.open_buy(data=d, size=ss, exectype='Market', date=current_date)
        
        busd_buys = busd_buys[:count_busd] if len(busd_buys) > count_busd else busd_buys
        for d in busd_buys:
            ss = (total_value_busd / d.price()) * 10
            broker.open_buy(data=d, size=ss, exectype='Market', date=current_date)


if __name__ == '__main__':
    main(debug=False)
