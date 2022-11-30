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
        handler = logging.FileHandler('livetrade_final.log', encoding='UTF-8')
        handler.setLevel(logging.INFO)
        self.logger.addHandler(handler)

    def log(self, txt):
        dt = datetime.now(tz=pytz.timezone('Asia/Shanghai'))
        msg = '%s, %s' % (dt.isoformat(), txt)
        self.logger.info(msg)
        print(msg)


class MyData:

    def __init__(self, symbol, exchange, logger, leverage, debug=False):
        self.symbol = symbol
        self.exchange = exchange
        self.logger = logger
        self.debug = debug
        self._leverage = leverage

        self._last_ts = 0
        self._data = []
        self._final_close = 0
        self._final_change = 0
        self._high = []
        self._low = []
        self._close = []
        self._has_error = False

    def name(self):
        return self.symbol

    def price(self, offset=0):
        index = len(self._close) - 1 - offset
        return self._close[index]

    def get_final_change(self):
        return self._final_change

    def has_error(self):
        return self._has_error

    def get_leverage(self):
        return self._leverage

    def fetch_data(self, since=None):
        if since is None:
            fromdate = datetime.utcnow() - timedelta(minutes=1000)
            since = self._last_ts - 5 * 60 * 1000 if self._last_ts > 0 else int(
                (fromdate - datetime(1970, 1, 1)).total_seconds() * 1000)
        if self.debug:
            self.logger.log('Fetching: {}, TF: {}, Since: {}, Limit: {}'.format(self.symbol, '1m', since, 1000))
        data = sorted(self.exchange.fetch_ohlcv(self.symbol, timeframe='1m', since=since, limit=1000))

        if len(data) == 0:
            self.logger.log('ERROR: {}, TF: {}, Since: {}, Limit: {}'.format(self.symbol, '1m', since, 1000))
            self._has_error = True
            return

        self._has_error = False

        # 总是把最后一分钟的去掉，上次获取的实时价格不是最终价格
        if len(self._data) > 0:
            self._data.pop()
            self._high.pop()
            self._low.pop()
            self._close.pop()
            last_ohlcv = self._data[len(self._data) - 1]
            self._last_ts = last_ohlcv[0]
            self._final_change = last_ohlcv[4] - last_ohlcv[1]

        for ohlcv in data:
            if None in ohlcv:
                continue
            tstamp = ohlcv[0]

            # Prevent from loading incomplete data
            # if tstamp > (time.time() * 1000):
            #    continue

            if tstamp > self._last_ts:
                ohlcv_map = self._load_ohlcv(ohlcv)
                self._high.append(ohlcv_map['high'])
                self._low.append(ohlcv_map['low'])
                self._close.append(ohlcv_map['close'])
                self._data.append(ohlcv)
                self._last_ts = tstamp
                if self.debug:
                    self.logger.log('Data: {}, Adding: {}'.format(self.symbol, ohlcv))

        # 只保留最近1000行，避免内存膨胀
        count = len(self._data)
        if count > 1000:
            self._data = self._data[count - 1000:]
            self._high = self._high[count - 1000:]
            self._low = self._low[count - 1000:]
            self._close = self._close[count - 1000:]

        self._final_close = self._close[len(self._data) - 1]  # 价格用实时价格，止损时误差更小

    def calc_pnt(self, period, offset):
        end_index = len(self._data) - 1 - offset
        close0 = self._close[end_index - period]
        close1 = self._close[end_index]
        pnt = (close1 - close0) / close0
        if self.debug:
            self.logger.log('symbol: {}, period: {}, offset: {}, pnt: {}'.format(self.symbol, period, offset, pnt))
        return pnt

    def calc_agree(self, period, offset):
        end_index = len(self._data) - offset
        start_index = end_index - period
        high = max(self._high[start_index:end_index])
        low = min(self._low[start_index:end_index])
        pnt = self.calc_pnt(period, offset)
        agree = pnt * low / (high - low)
        if self.debug:
            self.logger.log('symbol: {}, period: {}, offset: {}, agree: {}'.format(self.symbol, period, offset, agree))
        return agree

    def calc_avg(self, period, offset):
        pnts = []
        for i in range(6):
            pnts.append(abs(self.calc_pnt(period, (i + 1) * period + offset)))
        pnt = self.calc_pnt(period, offset)
        pnts_sum = sum(pnts)
        if pnts_sum == 0:
            self.logger.log(self.symbol + ':' + ','.join([str(i) for i in pnts]))
        avg = (pnt * len(pnts) / pnts_sum) if pnts_sum != 0 else 100
        if self.debug:
            self.logger.log('symbol: {}, period: {}, offset: {}, avg: {}'.format(self.symbol, period, offset, avg))
        return avg

    def calc_sma(self, period, offset):
        end_index = len(self._data) - offset
        start_index = end_index - period
        closes = self._close[start_index:end_index]
        sma = sum(closes)/len(closes)
        if self.debug:
            self.logger.log('symbol: {}, period: {}, offset: {}, sma: {}'.format(self.symbol, period, offset, sma))
        return sma

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


class MyBroker:

    def __init__(self, exchange, logger):
        self.exchange = exchange
        self.logger = logger
        self.position_datas = set()
        self.position_dates = dict()
        self.position_stop_loss = dict()
        self.position_stop_interval = dict()

    def hold(self, data):
        return data in self.position_datas

    def holds(self):
        return self.position_datas

    def get_size(self, name):
        positions = self.exchange.fetch_positions([name])
        return float(positions[0]['info']['positionAmt'])

    def get_date(self, name):
        return self.position_dates[name]

    def get_stop_interval(self, name):
        return self.position_stop_interval[name]

    def get_stop_loss(self, name):
        return self.position_stop_loss[name]

    def update_stop_loss(self, data):
        name = data.name()
        pos = self.get_size(name)
        change = data.get_final_change()
        if pos > 0 > change:
            self.position_stop_loss[name] -= change
        elif pos < 0 < change:
            self.position_stop_loss[name] -= change

    def open_position(self, d, date, side, pnt, interval):
        symbol = d.name()
        currency = 'USDT' if 'USDT' in symbol else 'BUSD'

        balance = self.exchange.fetch_balance()
        total_value = balance['total'][currency]
        cash = balance['free'][currency]
        self.logger.log('账户价值：%s, 现金: %s' % (total_value, cash))

        ratio = (total_value // 10)
        total_value = (5 * ratio if ratio > 0 else 5)
        if total_value > cash:
            return

        size = total_value * d.get_leverage() / d.price()

        self._submit(symbol=symbol, exectype='Market', side=side, amount=size, price=d.price())
        self.position_dates[symbol] = date
        self.position_stop_interval[symbol] = interval
        self.position_datas.add(d)

        pnt = abs(pnt)
        if pnt > 0.04:
            pnt = 0.04
        if side == 'sell':
            self.position_stop_loss[symbol] = d.price() * (1 + pnt)
        elif side == 'buy':
            self.position_stop_loss[symbol] = d.price() * (1 - pnt)

    # 关闭一个卖空
    def close_position(self, data, side):
        name = data.name()
        size = self.get_size(name)
        orderid = self._submit(symbol=name, exectype='Market', side=side, amount=abs(size), price=data.price())
        self.position_dates[name] = None
        self.position_stop_interval[name] = None
        self.position_stop_loss[name] = None
        self.position_datas.remove(data)
        profit = self.get_profit(name=name, order_id=orderid)
        self.logger.log('OPERATION PROFIT, symbol: {}, pnl: {}'.format(name, profit))

    def _submit(self, symbol, exectype, side, amount, price):
        ret_ord = self.exchange.create_order(symbol=symbol, type=exectype, side=side, amount=amount, price=price)
        order = self.exchange.fetch_order(ret_ord['id'], symbol)
        self.logger.log('symbol: {}, side: {}, price: {}, size: {}'.format(symbol, side, price, amount))
        return ret_ord['id']

    def get_profit(self, name, order_id):
        profit = 0
        for trade in self.exchange.fetch_my_trades(name):
            if trade['info']['orderId'] == order_id:
                profit += float(trade['info']['realizedPnl'])
        return profit


def main(debug=False, test=False):
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

    leverage = 10
    datas = dict()
    exchange = ccxt.binance(config)
    response = exchange.fapiPrivate_get_positionside_dual()
    if response['dualSidePosition']:
        exchange.fapiPrivate_post_positionside_dual({'dualSidePosition': False})
    markets = exchange.load_markets()

    for market in markets:
        if '_' in market:
            continue
        if market not in datas:
            max_leverage = int(exchange.fetchLeverageTiers([market])[market][0]['maxLeverage'])
            leverage = 10 if max_leverage > 10 else max_leverage
            datas[market] = MyData(symbol=market, exchange=exchange, logger=logger, leverage=leverage, debug=debug)
            exchange.set_leverage(leverage=leverage, symbol=market)
            exchange.set_margin_mode("isolated", symbol=market)
            datas[market].fetch_data()
    broker = MyBroker(exchange=exchange, logger=logger)
    btc = datas['BTC/USDT']

    time.sleep(5)
    logger.log('loop')

    while True:
        try:
            for market in datas:
                data = datas[market]
                data.fetch_data()

            current_date = datetime.utcnow()

            long_450 = btc.price() > btc.calc_sma(450, 0)
            long_450_1 = btc.price() > btc.calc_sma(450, 1)
            long_450_2 = btc.price() > btc.calc_sma(450, 2)
            long_888 = btc.price() > btc.calc_sma(888, 0)
            long_888_1 = btc.price() > btc.calc_sma(888, 1)
            long_888_2 = btc.price() > btc.calc_sma(888, 2)
            for market in datas:
                data = datas[market]
                if broker.hold(data) or data.has_error():
                    continue
                if long_450 and long_450_1 and long_450_2:
                    pnt = data.calc_pnt(15, 0)
                    if pnt >= 0.06 and data.calc_avg(15, 0) >= 10 and data.calc_agree(15, 0) >= 0.8:
                        # btc>450sma，15分钟>=0.06，15分钟>10*avg6，agree>0.8，1次确认做多，持仓60分钟
                        broker.open_position(d=data, date=current_date, side='buy', pnt=pnt, interval=60)
                    elif pnt >= 0.01 and data.calc_pnt(15, 1) >= 0.01 and data.calc_pnt(15, 2) >= 0.01 and \
                            data.calc_avg(15, 0) >= 10 and data.calc_avg(15, 1) >= 10 and data.calc_avg(15, 2) >= 10 \
                            and data.calc_agree(15, 0) >= 0.8 and data.calc_agree(15, 1) >= 0.8 and data.calc_agree(15, 2) >= 0.8:
                        # btc>450sma，15分钟>=0.01，15分钟>10*avg6，agree>0.8，3次确认做多，持仓15分钟
                        broker.open_position(d=data, date=current_date, side='buy', pnt=pnt, interval=15)
                elif not long_450 and not long_450_1 and not long_450_2:
                    pnt_15 = data.calc_pnt(15, 0)
                    if -0.05 <= pnt_15 <= -0.04 and -0.05 <= data.calc_pnt(15, 1) <= -0.04 and \
                            data.price(0) < data.calc_sma(99, 0) and data.price(1) < data.calc_sma(99, 1) \
                            and data.calc_agree(15, 0) <= -0.8 and data.calc_agree(15, 1) <= -0.8:
                        # btc<450sma，15分钟 in (-0.5, -0.4) and close<99sma and agree<=-0.8，2次确认做空，持仓15分钟
                        broker.open_position(d=data, date=current_date, side='sell', pnt=pnt_15, interval=15)

                if not long_888:
                    pnt_45 = data.calc_pnt(45, 0)
                    if pnt_45 >= 0.06 and data.calc_avg(45, 0) >= 10 and data.calc_agree(45, 0) >= 0.8:
                        # btc<888sma，45分钟>=0.06，45分钟>=10*avg6，agree>=0.8，1次确认做空，持仓60分钟
                        broker.open_position(d=data, date=current_date, side='sell', pnt=pnt_45, interval=60)

            for d in set(broker.holds()):
                name = d.name()
                size = broker.get_size(name=name)
                interval = (current_date - broker.get_date(name)).seconds / 60
                broker.update_stop_loss(d)

                if size > 0:
                    if interval > broker.get_stop_interval(name) or d.price() < broker.get_stop_loss(name):
                        broker.close_position(data=d, side='sell')
                else:
                    if interval > broker.get_stop_interval(name) or d.price() > broker.get_stop_loss(name):
                        broker.close_position(data=d, side='buy')

        except Exception as e:
            logger.log("exception: %s" % e)


if __name__ == '__main__':
    main(debug=False)
