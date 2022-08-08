from ccxtbt import CCXTStore
import backtrader as bt
from datetime import datetime, timedelta
import json
import pytz
from backtrader import Order
from samples.myind.global_ind import Global


class TestStrategy(bt.Strategy):

    def __init__(self):
        self.wintimes = 0
        self.losetimes = 0
        self.inds = dict()
        self.live_data = False
        self.status = ''
        # 记录每次的涨跌振幅前n的名称，用于计算下个周期涨跌幅
        self.asc_topn = []
        self.dec_topn = []
        self.shock_topn = []
        self.topn = 5
        self.filter_change = 0.01
        self.filter_change2 = 0.02

        #
        self.pre_asc_topn_average = None
        self.pre_dec_topn_average = None
        self.pre_shock_topn_average = None
        self.average = None
        self.max = None
        self.min = None
        self.max_shock = None

        # 计算上涨数量，下跌数量
        self.filter_inc_num = None
        self.filter_dec_num = None

        # 计算topn涨跌震幅平均涨幅
        self.asc_topn_average = None
        self.dec_topn_average = None
        self.shock_topn_average = None
        self.pnts = dict()

    def next(self):
        changes = []
        shocks = []
        pre_asc_topn_changes = []
        pre_dec_topn_changes = []
        pre_asc_topn_shocks = []
        changes_sum = 0
        changes_max = 0
        changes_min = 0
        shocks_max = 0
        filter_inc_changes = []
        filter_dec_changes = []
        for d in self.datas:
            change = (d.close[0] - d.open[0]) / d.open[0]
            shock = (d.high[0] - d.low[0]) / d.open[0]
            changes.append(change)
            shocks.append(shock)
            changes_sum += change
            if change > changes_max:
                changes_max = change
            if change < changes_min:
                changes_min = change
            if shock > shocks_max:
                shocks_max = shock
            # 收集超过阈值的涨跌幅
            if change > self.filter_change:
                filter_inc_changes.append(change)
            elif change < -self.filter_change:
                filter_dec_changes.append(change)

            name = d._name
            if name in self.asc_topn:
                pre_asc_topn_changes.append(change)
            if name in self.dec_topn:
                pre_dec_topn_changes.append(change)
            if name in self.shock_topn:
                pre_asc_topn_shocks.append(change)
            self.pnts[name] = change

        # 计算昨日涨跌振幅前n的今日涨幅
        self.pre_asc_topn_average = (sum(pre_asc_topn_changes) / len(pre_asc_topn_changes)) if len(pre_asc_topn_changes) > 0 else 0
        self.pre_dec_topn_average = (sum(pre_dec_topn_changes) / len(pre_dec_topn_changes)) if len(pre_dec_topn_changes) > 0 else 0
        self.pre_shock_topn_average = (sum(pre_asc_topn_shocks) / len(pre_asc_topn_shocks)) if len(pre_asc_topn_shocks) > 0 else 0

        # 排序涨跌幅、振幅
        sorted_asc_changes = sorted(enumerate(changes), key=lambda x: x[1], reverse=True)
        sorted_dec_changes = sorted(enumerate(changes), key=lambda x: x[1], reverse=False)
        sorted_shocks = sorted(enumerate(shocks), key=lambda x: x[1], reverse=True)

        # 收集本次前n涨跌幅、振幅，用于计算下个周期的涨幅
        self.asc_topn.clear()
        self.dec_topn.clear()
        self.shock_topn.clear()

        asc_changes_sum = 0
        dec_changes_sum = 0
        shock_changes_sum = 0
        for i, v in enumerate(sorted_asc_changes):
            if i < self.topn:
                idx = v[0]
                self.asc_topn.append(self.datas[idx]._name)
                asc_changes_sum += v[1]
            else:
                break
        for i, v in enumerate(sorted_dec_changes):
            if i < self.topn:
                idx = v[0]
                self.dec_topn.append(self.datas[idx]._name)
                dec_changes_sum += v[1]
            else:
                break
        for i, v in enumerate(sorted_shocks):
            if i < self.topn:
                idx = v[0]
                self.shock_topn.append(self.datas[idx]._name)
                shock_changes_sum += changes[v[0]]
            else:
                break

        # 计算全局平均，最大涨幅，最大跌幅，最大振幅
        self.average = changes_sum / len(changes)
        self.max = changes_max
        self.min = changes_min
        self.max_shock = shocks_max

        # 计算上涨数量，下跌数量
        self.filter_inc_num = len(filter_inc_changes)
        self.filter_dec_num = len(filter_dec_changes)

        # 计算topn涨跌震幅平均涨幅
        self.asc_topn_average = asc_changes_sum / self.topn
        self.dec_topn_average = dec_changes_sum / self.topn
        self.shock_topn_average = shock_changes_sum / self.topn

        self.log('市场平均涨幅:{}，上涨数量：{}，下跌数量：{}，涨幅前N平均：{}，跌幅前N平均：{}, 振幅前N平均：{}'.format(
            self.average, self.filter_inc_num, self.filter_dec_num,
            self.asc_topn_average, self.dec_topn_average, self.shock_topn_average
        ))
        self.log('最大涨幅:{}，最大跌幅：{}，最大振幅：{}'.format(
            self.max, self.min, self.max_shock
        ))
        self.log('昨日涨幅前N涨幅:{}，昨日跌幅前N涨幅：{}，昨日振幅前N涨幅：{}'.format(
            self.pre_asc_topn_average, self.pre_dec_topn_average, self.pre_shock_topn_average
        ))
        # if self.pre_asc_topn_average > 0 and self.pre_dec_topn_average > 0 and self.pre_shock_topn_average > 0 and \
        #         self.filter_inc_num > self.filter_dec_num and \
        #         self.average > 0 and (self.asc_topn_average + self.dec_topn_average) > 0:
        #     self.status = 'buy'
        # elif self.pre_asc_topn_average < 0 and self.pre_dec_topn_average < 0 and self.pre_shock_topn_average < 0 and \
        #         self.filter_inc_num < self.filter_dec_num and \
        #         self.average < 0 and (self.asc_topn_average + self.dec_topn_average) < 0:
        #     self.status = 'sell'

        total_value = self.broker.getvalue()
        self.log('账户价值：%s' % (total_value,))

        inxs = [i[0] for i in sorted_asc_changes]
        buys = []
        for i, idx in enumerate(inxs):
            d = self.datas[idx]
            pnt = self.pnts[d._name]
            pos = self.getposition(d).size
            if i < 10:
                if pnt > 0.02:
                    buys.append(d)
            if pos:
                self.sell(data=d, size=pos, exectype=Order.Market)
        for d in buys:
            ss = (total_value * 0.08) / d.close[0]
            self.buy(data=d, size=ss, exectype=Order.Market)

        # if self.filter_inc_num > self.filter_dec_num:
        #     buys = []
        #     for i, v in enumerate(sorted_asc_changes):
        #         idx = v[0]
        #         change = v[1]
        #         d = self.datas[idx]
        #         pos = self.getposition(d).size
        #         if i < self.topn and change > self.filter_change2:
        #             if not pos:
        #                 buys.append(d)
        #             elif pos < 0:  # 有空单就平了
        #                 self.close(data=d, size=pos, exectype=Order.Market)
        #         elif pos:
        #             self.close(data=d, size=pos, exectype=Order.Market)
        #     for d in buys:
        #         ss = (total_value * 0.08) / d.close[0]
        #         self.buy(data=d, size=ss, exectype=Order.Market)
        # elif self.filter_inc_num < self.filter_dec_num:
        #     sells = []
        #     for i, v in enumerate(sorted_dec_changes):
        #         idx = v[0]
        #         change = v[1]
        #         d = self.datas[idx]
        #         pos = self.getposition(d).size
        #         if i < self.topn and change < -self.filter_change2:
        #             if not pos:
        #                 sells.append(d)
        #             elif pos > 0:  # 有多单就平了
        #                 self.close(data=d, size=pos, exectype=Order.Market)
        #         elif pos:
        #             self.close(data=d, size=pos, exectype=Order.Market)
        #     for d in sells:
        #         ss = (total_value * 0.08) / d.close[0]
        #         self.sell(data=d, size=ss, exectype=Order.Market)
        # else:
        #     for d in self.datas:
        #         pos = self.getposition(d).size
        #         if pos:
        #             self.close(data=d, exectype=Order.Market)

    def notify_data(self, data, status, *args, **kwargs):
        dn = data._name
        dt = datetime.now()
        msg= 'Data Status: {}'.format(data._getstatusname(status))
        print(dt,dn,msg)
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
        print('%s, %s, %s' % (dt.isoformat(), tm, txt))


with open('../params.json', 'r') as f:
    params = json.load(f)
with open('../symbols.txt', 'r') as f:
    symbols = f.read().split('\n')

cerebro = bt.Cerebro(quicknotify=True)
cerebro.addobserver(bt.observers.DrawDown)

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
hist_start_date = datetime.utcnow() - timedelta(minutes=15 * 4 * 24 * 10)
data0 = None
for v in symbols:
    data = store.getdata(dataname=v, name=v, market='future',
                     timeframe=bt.TimeFrame.Minutes, fromdate=hist_start_date,
                     compression=15, ohlcv_limit=1000, drop_newest=True, historical=True)
    data.plotinfo.plot = False
    # Add the feed
    cerebro.adddata(data)

# Run the strategy
cerebro.run()
cerebro.plot()
