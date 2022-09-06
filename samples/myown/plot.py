from ccxtbt import CCXTStore
import backtrader as bt
from datetime import datetime, timedelta
import json
import pytz
from backtrader import Order
import logging


class TestStrategy(bt.Strategy):

    def __init__(self):
        self.wintimes = 0
        self.losetimes = 0
        self.inds = dict()
        self.live_data = False
        self.status = ''
        self.pnts = dict()
        self.position_datas = set()
        self.position_dates = dict()
        self.position_prices = dict()
        self.logger = logging.getLogger()
        self.logger.setLevel(logging.INFO)
        self.pre_buys = []
        self.pre_sells = []
        handler = logging.FileHandler('logfile.log', encoding='UTF-8')
        handler.setLevel(logging.INFO)
        self.logger.addHandler(handler)
        for d in self.datas:
            self.inds[d] = dict()
            self.inds[d]['pnt'] = bt.indicators.PctChange(d.close, period=15)
            self.inds[d]['change'] = bt.indicators.PctChange(d.close, period=1)
            self.inds[d]['high'] = bt.indicators.Highest(d.high, period=15)
            self.inds[d]['low'] = bt.indicators.Lowest(d.low, period=15)
            self.inds[d]['high_close'] = bt.indicators.Highest(d.close, period=100)
            self.inds[d]['low_close'] = bt.indicators.Lowest(d.close, period=100)
            self.inds[d]['atr'] = bt.indicators.AverageTrueRange(d, period=15)

    def next(self):
        pnts = []
        self.pnts.clear()
        for d in self.datas:
            pnt = self.inds[d]['pnt'][0]
            pnts.append(pnt)
            self.pnts[d._name] = pnt
        sorted_pnts = sorted(enumerate(pnts), key=lambda x: x[1], reverse=True)
        inxs = [i[0] for i in sorted_pnts]

        buys = []
        sells = []
        for idx in inxs:
            d = self.datas[idx]
            pnt = self.pnts[d._name]
            # 15分钟累计涨幅>2，100分钟新高，上影小于2个点
            if pnt >= 0.02:
                atr = self.inds[d]['atr'][0]
                if atr <= d.close[0] * 0.01 and \
                    self.inds[d]['pnt'][-15] > 0.02 and d.close[0] >= self.inds[d]['high_close'][0] and \
                        d.close[0] >= self.inds[d]['high'] * 0.97:
                    buys.append(d)
            else:
                break
        for idx in reversed(inxs):
            d = self.datas[idx]
            pnt = self.pnts[d._name]
            # 15分钟累计涨幅>2，100分钟新高，上影小于2个点
            if pnt <= -0.02:
                atr = self.inds[d]['atr'][0]
                if atr <= d.close[0] * 0.01 and \
                    self.inds[d]['pnt'][-15] < -0.02 and d.close[0] <= self.inds[d]['low_close'][0] and \
                        d.close[0] <= self.inds[d]['low'] * 1.03:
                    sells.append(d)
            else:
                break
            # if pnt > 0.03 and d.close[0] >= self.inds[d]['high_close'][0] and d.close[0] >= self.inds[d]['high'] * 0.98:
            #     buys.append(d)
            # elif pnt < -0.03 and d.close[0] <= self.inds[d]['low_close'][0] and d.close[0] <= self.inds[d]['low'] * 1.02:
            #     sells.append(d)

        total_value = self.broker.getvalue()
        if len(buys) > 0 or len(sells) > 0:
            self.log('账户价值：%s' % (total_value,))

        # 空头行情，清仓
        short_time = len(sells) > len(buys)
        current_date = self.datas[0].datetime.datetime()

        for d in set(self.position_datas):
            pos = self.getposition(d)
            size = pos.size
            name = d._name
            interval = (current_date - self.position_dates[name]).seconds / 60
            price = self.position_prices[name]
            if size > 0:
                if d.close[0] < price * 0.99 or (d.close[0] < price * 1.02 and interval > 15) or \
                        d.close[0] < self.inds[d]['high'][0] * 0.97:
                    self.close_sell(data=d, size=size, exectype=Order.Market)
                elif interval > 15:  # 可以加仓
                    continue

                buys.remove(d) if d in buys else None
            elif size < 0:
                if d.close[0] > price * 1.01 or (d.close[0] > price * 0.98 and interval > 15) or \
                        d.close[0] > self.inds[d]['low'][0] * 1.03:
                    self.close_buy(data=d, size=size, exectype=Order.Market)
                elif interval > 15:  # 可以加仓
                    continue

                sells.remove(d) if d in sells else None

        count = 10 - len(self.position_datas)
        total_value = 5000

        act_buys = list(filter(lambda x: x in self.pre_buys, buys))
        act_buys = act_buys[:count] if len(act_buys) > count else act_buys
        for d in act_buys:
            ss = total_value / d.close[0]
            self.open_buy(data=d, size=ss, exectype=Order.Market, date=current_date)

        act_sells = list(filter(lambda x: x in self.pre_sells, sells))
        act_sells = act_sells[:count] if len(act_sells) > count else act_sells
        for d in act_sells:
            ss = total_value / d.close[0]
            self.open_sell(data=d, size=ss, exectype=Order.Market, date=current_date)

        self.pre_buys = buys
        self.pre_sells = sells

    def open_buy(self, data, size, exectype, date):
        name = data._name
        self.buy(data=data, size=size, exectype=exectype)
        self.position_dates[name] = date
        self.position_prices[name] = data.close[0]
        self.position_datas.add(data)

    def open_sell(self, data, size, exectype, date):
        name = data._name
        self.sell(data=data, size=size, exectype=exectype)
        self.position_dates[name] = date
        self.position_prices[name] = data.close[0]
        self.position_datas.add(data)

    # 关闭一个卖空
    def close_buy(self, data, size, exectype):
        name = data._name
        self.buy(data=data, size=size, exectype=exectype)
        self.position_dates[name] = None
        self.position_prices[name] = None
        self.position_datas.remove(data)

    # 关闭一个做多
    def close_sell(self, data, size, exectype):
        name = data._name
        self.sell(data=data, size=size, exectype=exectype)
        self.position_dates[name] = None
        self.position_prices[name] = None
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
        else:
            self.losetimes += 1
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
                    'BUY EXECUTED, Price: %.2f, Cost: %.2f, Comm %.2f, size %.2f, Name: %s, pnt %.2f' %
                    (order.executed.price,
                     order.executed.value,
                     order.executed.comm,
                     order.executed.size,
                     name,
                     self.pnts[name]))

            else:  # Sell
                self.log('SELL EXECUTED, Price: %.2f, Cost: %.2f, Comm %.2f, size %.2f, Name: %s, pnt %.2f' %
                         (order.executed.price,
                          order.executed.value,
                          order.executed.comm,
                          order.executed.size,
                          name,
                          self.pnts[name]))
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
with open('../symbols.txt', 'r') as f:
    symbols = f.read().split('\n')
symbols = ['WAVESUSDT']

cerebro = bt.Cerebro(quicknotify=True)


# Add the strategy
cerebro.addstrategy(TestStrategy)
cerebro.broker.setcash(100000)
# 设置交易手续费为 0.1%
cerebro.broker.setcommission(commission=0.004, mult=10)

# Create our store
config = {'apiKey': params["binance"]["apikey"],
          'secret': params["binance"]["secret"],
          'enableRateLimit': True,
          'options': {
              'defaultType': 'future'
            }
          }


# IMPORTANT NOTE - Kraken (and some other exchanges) will not return any values
# for get cash or value if You have never held any BNB coins in your account.
# So switch BNB to a coin you have funded previously if you get errors
store = CCXTStore(exchange='binance', currency='USDT', config=config, retries=5, debug=False)

# Get our data
# Drop newest will prevent us from loading partial data from incomplete candles
hist_start_date = datetime.utcnow() - timedelta(minutes=15 * 4 * 24 * 92)
hist_end_date = datetime.utcnow() - timedelta(minutes=15 * 4 * 24 * 60)
data0 = None
for v in symbols:
    data = store.getdata(dataname=v, name=v, market='future',
                     timeframe=bt.TimeFrame.Minutes, fromdate=hist_start_date, todate=hist_end_date,
                     compression=1, ohlcv_limit=1000, debug=False)
    # Add the feed
    cerebro.adddata(data)

# Run the strategy
cerebro.run()
cerebro.plot(style='candlestick')
