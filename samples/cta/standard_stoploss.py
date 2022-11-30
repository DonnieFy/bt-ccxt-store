from ccxtbt import CCXTStore
import backtrader as bt
from datetime import datetime, timedelta
import json
import pytz
from backtrader import Order
import logging
import ccxt


class TestStrategy(bt.Strategy):

    def __init__(self):
        self.wintimes = 0
        self.losetimes = 0
        self.inds = dict()
        self.live_data = False
        self.position_datas = set()
        self.position_dates = dict()
        self.position_prices = dict()
        self.position_high = dict()
        self.position_stop = dict()
        self.waiting_dates = dict()
        self.logger = logging.getLogger()
        self.logger.setLevel(logging.INFO)
        self.pre_buys = []
        self.pre_buys2 = []
        self.www = 0
        handler = logging.FileHandler('logfile_stoploss.log', encoding='UTF-8')
        handler.setLevel(logging.INFO)
        self.logger.addHandler(handler)
        self.sma = bt.indicators.SMA(self.datas[0], period=1200)
        for d in self.datas:
            self.inds[d] = dict()
            self.inds[d]['pnt_30'] = bt.indicators.PctChange(d.close, period=30)
            self.inds[d]['high_30'] = bt.indicators.Highest(d.high, period=30)
            self.inds[d]['low_30'] = bt.indicators.Lowest(d.low, period=30)
            # self.inds[d]['sma'] = bt.indicators.SMA(d, period=99)

    def next(self):
        current_date = self.datas[0].datetime.datetime()
        buys = []
        sells = []
        long = self.datas[0].close[0] > self.sma[0]
        for d in self.datas:
            if d in self.position_datas:
                self.update_stop(data=d)
                continue

            # if d._name in self.waiting_dates and (current_date - self.waiting_dates[d._name]).seconds / 60 < 15:
            #     continue

            pnt_30 = self.inds[d]['pnt_30'][0]
            high = self.inds[d]['high_30'][0]
            low = self.inds[d]['low_30'][0]
            if long and 0.01 <= pnt_30 and pnt_30 >= 0.8 * (high-low)/low:
                pnts = []
                for i in range(6):
                    pnts.append(abs(self.inds[d]["pnt_30"][-30 * (i + 1)]))
                if pnt_30 >= 10 * sum(pnts) / len(pnts):
                    buys.append(d)

        total_value = self.broker.getvalue()
        if len(buys) > 0 or len(sells) > 0:
            self.log('账户价值：%s' % (total_value,))

        if len(buys) > 5:
            for d in buys:
                self.waiting_dates[d._name] = current_date
            buys.clear()

        # 空头行情，清仓
        short_time = len(sells) > len(buys)

        for d in set(self.position_datas):
            pos = self.getposition(d)
            size = pos.size
            name = d._name
            interval = (current_date - self.position_dates[name]).seconds / 60

            if size > 0:
                if interval >= 45 or d.close[0] <= self.position_stop[name]:
                    self.close_sell(data=d, size=size, exectype=Order.Market)
                buys.remove(d) if d in buys else None

        count = 10 - len(self.position_datas)
        ratio = (total_value // 100000)
        base = 10000
        total_value = (base * ratio if ratio > 0 else base)

        act_buys = list(filter(lambda x: x in self.pre_buys and x in self.pre_buys2, buys))
        # act_buys = buys
        act_buys = act_buys[:count] if len(act_buys) > count else act_buys
        for d in act_buys:
            ss = total_value / d.close[0]
            self.open_buy(data=d, size=ss, exectype=Order.Market, date=current_date)

        self.pre_buys2 = self.pre_buys
        self.pre_buys = buys

    def update_stop(self, data):
        name = data._name
        pos = self.getposition(data)
        change = data.close[0] - data.open[0]
        if pos.size > 0 > change:
            self.position_stop[name] -= change
        elif pos.size < 0 < change:
            self.position_stop[name] -= change

    def open_buy(self, data, size, exectype, date):
        name = data._name
        self.buy(data=data, size=size, exectype=exectype)
        self.position_dates[name] = date
        self.position_prices[name] = data.close[0]
        pnt_30 = self.inds[data]['pnt_30'][0]

        self.position_stop[name] = data.close[0] * (1 - pnt_30)
        self.position_datas.add(data)

    # 关闭一个做多
    def close_sell(self, data, size, exectype):
        name = data._name
        self.sell(data=data, size=size, exectype=exectype)
        self.position_dates[name] = None
        self.position_prices[name] = None
        self.position_stop[name] = None
        self.position_high[name] = None
        self.position_datas.remove(data)

    def notify_data(self, data, status, *args, **kwargs):
        dn = data._name
        dt = datetime.now(tz=pytz.timezone('Asia/Shanghai'))
        msg = 'Data Status: {}, Name: {}'.format(data._getstatusname(status), dn)
        print(dt, msg)
        if data._getstatusname(status) == 'LIVE':
            self.live_data = True
        else:
            self.live_data = False

    def notify_trade(self, trade):
        if not trade.isclosed:
            return
        if trade.pnl > 0:
            self.wintimes += 1
            self.www += 1
        else:
            self.losetimes += 1
            self.www = 0
        name = trade.data._name
        self.log('OPERATION PROFIT, GROSS %.2f, NET %.2f, WIN %s LOSE %s TOTAL %s, NAME %s' %
                 (trade.pnl, trade.pnlcomm, self.wintimes, self.losetimes, self.wintimes + self.losetimes, name))

    def notify_order(self, order):
        if order.status in [order.Submitted, order.Accepted]:
            # Buy/Sell order submitted/accepted to/by broker - Nothing to do
            return
        order.executed
        # Check if an order has been completed
        # Attention: broker could reject order if not enough cash
        if order.status in [order.Completed]:
            name = order.data._name
            if order.isbuy():
                self.log(
                    'BUY EXECUTED, Price: %.2f, Cost: %.2f, Comm %.2f, size %.2f, Name: %s' %
                    (order.executed.price,
                     order.executed.value,
                     order.executed.comm,
                     order.executed.size,
                     name))

            else:  # Sell
                self.log('SELL EXECUTED, Price: %.2f, Cost: %.2f, Comm %.2f, size %.2f, Name: %s' %
                         (order.executed.price,
                          order.executed.value,
                          order.executed.comm,
                          order.executed.size,
                          name))
        elif order.status in [order.Canceled, order.Margin, order.Rejected]:
            ordertype = 'buy' if order.isbuy() else 'sell'
            status = 'canceled' if order.status == order.Canceled else \
                'margin' if order.status == order.Margin else 'rejected'
            self.log('%s Order %s' % (ordertype, status))

    def log(self, txt, dt=None, tm=None):
        """ Logging function fot this strategy"""
        dtt = self.datas[0].datetime.datetime(tz=pytz.timezone('Asia/Shanghai'))
        dt = dt or dtt.date()
        tm = tm or dtt.time()
        msg = '%s, %s, %s' % (dt.isoformat(), tm, txt)
        self.logger.info(msg)
        print(msg)


with open('../params.json', 'r') as f:
    params = json.load(f)

cerebro = bt.Cerebro(quicknotify=True)

# Add the strategy
cerebro.addobserver(bt.observers.DrawDown)
cerebro.addstrategy(TestStrategy)
cerebro.broker.setcash(100000)
# 设置交易手续费为 0.1%
cerebro.broker.setcommission(commission=0.004, mult=10)

# Create our store
config = {'apiKey': params["binance"]["apikey"],
          # 'secret': params["binance"]["secret"],
          'enableRateLimit': True,
          'options': {
              'defaultType': 'future'
            }
          }

with open('../symbols.txt', 'r') as f:
    symbols = f.read().split(" ")

# IMPORTANT NOTE - Kraken (and some other exchanges) will not return any values
# for get cash or value if You have never held any BNB coins in your account.
# So switch BNB to a coin you have funded previously if you get errors
store = CCXTStore(exchange='binance', currency='USDT', config=config, retries=5, debug=False)

# Get our data
# Drop newest will prevent us from loading partial data from incomplete candles

utcnow = datetime.utcfromtimestamp(1666779060000 // 1000)
hist_start_date = utcnow - timedelta(minutes=60 * 24 * 60 * 1)
hist_end_date = utcnow - timedelta(minutes=60 * 24 * 3 * 1)
data0 = None
for v in symbols:
    data = store.getdata(dataname=v, name=v, market='future',
                     timeframe=bt.TimeFrame.Minutes, fromdate=hist_start_date, todate=hist_end_date,
                     compression=1, ohlcv_limit=1000, debug=False, historical=True)
    # Add the feed
    if data0 is None:
        data0 = data
    else:
        data.plotinfo.plot = False
    cerebro.adddata(data)

# Run the strategy
cerebro.run()
cerebro.plot()
