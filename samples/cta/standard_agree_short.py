from ccxtbt import CCXTStore
import backtrader as bt
from datetime import datetime, timedelta
import json
import pytz
from backtrader import Order
import logging
import ccxt

const_pnt = 'pnt_45'
const_pnt_30 = 'pnt_30'
const_high = 'high_15'
const_low = 'low_15'
const_period = 60  # 计算周期
const_hold_period = 60  # 持仓周期
const_stop_loss = 0.95  # 止损
const_agree = 0.8  # 一致性比率
const_period_range = 7  # 和过去多少个周期比较
const_factor = 10  # 涨幅超过平均涨幅因子
const_min_pnt = 0.04  # 最小涨幅
const_max_pnt = 0.08  # 最大涨幅


class TestStrategy(bt.Strategy):

    def __init__(self):
        self.wintimes = 0
        self.losetimes = 0
        self.inds = dict()
        self.live_data = False
        self.position_datas = set()
        self.position_dates = dict()
        self.position_prices = dict()
        self.position_stop_loss = dict()
        self.position_stop_profit = dict()
        self.logger = logging.getLogger()
        self.logger.setLevel(logging.INFO)
        self.pre_sells = []
        self.pre_sells2 = []
        handler = logging.FileHandler('logfile_agree_short.log', encoding='UTF-8')
        handler.setLevel(logging.INFO)
        self.logger.addHandler(handler)
        self.sma = bt.indicators.SMA(self.datas[0], period=888)
        self.ratios = dict()
        for d in self.datas:
            self.inds[d] = dict()
            self.inds[d]["pnt_45"] = bt.indicators.PctChange(d.close, period=45)
            self.inds[d]["low_45"] = bt.indicators.Lowest(d.low, period=45)
            self.inds[d]["high_45"] = bt.indicators.Highest(d.high, period=45)
            # self.inds[d][const_pnt_30] = bt.indicators.PctChange(d.close, period=60)
            # self.inds[d][const_high] = bt.indicators.Highest(d.high, period=const_period)
            # self.inds[d][const_low] = bt.indicators.Lowest(d.low, period=const_period)
            # self.inds[d]['sma'] = bt.indicators.SMA(d, period=210)

    def ana(self, d):
        for i in range(10):
            index = -const_period*i
            rag = abs(self.inds[d][const_high][index] - self.inds[d][const_low][index]) / d.open[index]
            pnt = self.inds[d][const_pnt][index]
            self.log('name: {}, index: {}, pnt: {}, range: {}, ratio: {}'.format(d._name, i, pnt, rag, pnt/rag))

    def calc_ratio(self, d, index=0):
        rag = abs(self.inds[d][const_high][index] - self.inds[d][const_low][index]) / d.open[index]
        pnt = self.inds[d][const_pnt][index]
        return pnt/rag

    def need_sell(self, d):
        # if d.close[0] > self.inds[d]['sma'][0]:
        #     return False
        # pnts = []
        # for i in range(const_period_range):
        #     pnts.append(abs(self.inds[d][const_pnt][-const_period*(i+1)]))
        if self.inds[d]["pnt_45"][0] == 0:
            return False

        low = self.inds[d]['low_45'][0]
        high = self.inds[d]['high_45'][0]
        pnt = self.inds[d]["pnt_45"][0]
        if pnt >= 0.06 and pnt > 0.8*(high-low)/low:
            pnts = []
            for offset in range(6):
                pnts.append(abs(self.inds[d]["pnt_45"][(-1 - offset)*45]))
            if pnt > 10 * sum(pnts) / len(pnts):
                return True

        return False

    def next(self):
        buys = []
        sells = []
        long = self.datas[0].close[0] > self.sma[0]
        for d in self.datas:
            if d in self.position_datas:
                continue
            if not long and self.need_sell(d):
                sells.append(d)
        buys.sort(key=lambda x: self.inds[x][const_pnt][0], reverse=True)

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

            if size < 0:
                self.update_stop(d)
                if interval > const_hold_period or d.close[0] > self.position_stop_loss[name]:
                    self.close_sell(data=d, size=size, exectype=Order.Market)
                sells.remove(d) if d in sells else None

        count = 10 - len(self.position_datas)
        ratio = (total_value // 100000)
        total_value = (10000 * ratio if ratio > 0 else 10000)
        total_value = 10000

        acc_sells = list(filter(lambda x: x not in sells and x not in self.pre_sells, self.pre_sells2))
        acc_sells = sells
        acc_sells = acc_sells[:count] if len(acc_sells) > count else acc_sells
        for d in acc_sells:
            ss = total_value / d.close[0]
            self.open_sell(data=d, size=ss, exectype=Order.Market, date=current_date)
        self.pre_sells2 = self.pre_sells
        self.pre_sells = sells

    def update_stop(self, data):
        name = data._name
        pos = self.getposition(data)
        change = data.close[0] - data.open[0]
        if pos.size > 0 > change:
            self.position_stop_loss[name] -= change
        elif pos.size < 0 < change:
            self.position_stop_loss[name] -= change

    def open_sell(self, data, size, exectype, date):
        name = data._name
        self.sell(data=data, size=size, exectype=exectype)
        self.position_dates[name] = date
        self.position_prices[name] = data.close[0]
        self.position_datas.add(data)
        pnt = self.inds[data][const_pnt][0]
        self.position_stop_loss[name] = data.close[0] * (1 + (pnt if pnt > 0 else -pnt))

    # 关闭一个做多
    def close_sell(self, data, size, exectype):
        name = data._name
        self.buy(data=data, size=size, exectype=exectype)
        self.position_dates[name] = None
        self.position_prices[name] = None
        self.position_stop_loss[name] = None
        self.position_stop_profit[name] = None
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

exchange = ccxt.binance(config)

with open('../symbols.txt', 'r') as f:
    symbols = f.read().split(" ")


# IMPORTANT NOTE - Kraken (and some other exchanges) will not return any values
# for get cash or value if You have never held any BNB coins in your account.
# So switch BNB to a coin you have funded previously if you get errors
store = CCXTStore(exchange='binance', currency='USDT', config=config, retries=5, debug=False)

# Get our data
# Drop newest will prevent us from loading partial data from incomplete candles

# utcnow = datetime.utcfromtimestamp(int((datetime.utcnow() - datetime(1970, 1, 1)).total_seconds() // 60) * 60)
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
