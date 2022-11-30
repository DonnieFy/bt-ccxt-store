from ccxtbt import CCXTStore
import backtrader as bt
from datetime import datetime, timedelta
import json
import pytz
from backtrader import Order

pnts = ['pnt_15', 'pnt_30', 'pnt_45', 'pnt_60']
inds_high = ['high_15', 'high_30', 'high_45', 'high_60']
inds_low = ['low_15', 'low_30', 'low_45', 'low_60']
levels = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06]
times = ['0', '15', '30', '45', '60']

result_pnt_sum = dict()
result_count = dict()
result_win = dict()
result_lose = dict()


class TestStrategy(bt.Strategy):

    def __init__(self):
        self.wintimes = 0
        self.losetimes = 0
        self.inds = dict()
        self.live_data = False
        self.status = ''
        self.pnts = dict()
        self.postion_buys = []
        self.buys = dict()
        self.buy_prices = dict()
        self.sma = bt.indicators.SMA(self.datas[0], period=30)
        for d in self.datas:
            self.inds[d] = dict()
            self.inds[d]['high_15'] = bt.indicators.Highest(d.high, period=1)
            self.inds[d]['high_30'] = bt.indicators.Highest(d.high, period=2)
            self.inds[d]['high_45'] = bt.indicators.Highest(d.high, period=3)
            self.inds[d]['high_60'] = bt.indicators.Highest(d.high, period=4)
            self.inds[d]['low_15'] = bt.indicators.Lowest(d.low, period=1)
            self.inds[d]['low_30'] = bt.indicators.Lowest(d.low, period=2)
            self.inds[d]['low_45'] = bt.indicators.Lowest(d.low, period=3)
            self.inds[d]['low_60'] = bt.indicators.Lowest(d.low, period=4)
            self.inds[d]['pnt_15'] = bt.indicators.PctChange(d.close, period=1)
            self.inds[d]['pnt_30'] = bt.indicators.PctChange(d.close, period=2)
            self.inds[d]['pnt_45'] = bt.indicators.PctChange(d.close, period=3)
            self.inds[d]['pnt_60'] = bt.indicators.PctChange(d.close, period=4)
            # self.inds[d]['sma'] = bt.indicators.SMA(d, period=20)

    def next(self):
        self.pnts.clear()
        long = self.datas[0].close[0] >= self.sma[0]
        for i in range(4):
            pnt_name = pnts[i]
            for level in levels:
                buy_times = self.get_buy_times(ind=pnt_name,  level=level)
                for d in self.datas:
                    if d in buy_times:
                        self.add_buy_times(ind=pnt_name, level=level, data=d)
                    elif long:
                        low = self.inds[d][inds_low[i]][0]
                        high = self.inds[d][inds_high[i]][0]
                        pnt = self.inds[d][pnt_name][0]

                        # temp_pnts = []
                        # for offset in range(6):
                        #     temp_pnts.append(abs(self.inds[d][pnt_name][-1-offset]))

                        if level <= pnt < 0.8 * (high - low)/low:
                            self.add_buy_times(ind=pnt_name, level=level, data=d)

    def add_buy_times(self, ind, level, data):
        buy_times = self.get_buy_times(ind=ind, level=level)
        key = ind + '--' + str(level)
        if data not in buy_times:
            buy_times[data] = '0'
            if key not in result_count:
                result_count[key] = 1
            else:
                result_count[key] = result_count[key] + 1
        else:
            time = buy_times[data]
            index = times.index(time)
            pnt = self.inds[data][pnts[index]][0]
            index += 1
            self.log('{} 涨幅 {}，{} 分钟后涨幅 {}'.format(ind, level, times[index], pnt))
            key += '---' + times[index]
            if key not in result_pnt_sum:
                result_pnt_sum[key] = pnt
                result_win[key] = 0
                result_lose[key] = 0
            else:
                result_pnt_sum[key] = result_pnt_sum[key] + pnt
            if pnt > 0:
                result_win[key] = result_win[key] + 1
            elif pnt < 0:
                result_lose[key] = result_lose[key] + 1

            if index == 4:
                # 过了60就清掉
                buy_times.pop(data)
            else:
                # 不到60就加一位
                buy_times[data] = times[index]

    # pnt_15 -- 0.03 -- 15  ： 15分钟涨幅>0.03，持仓15分钟
    def get_buy_times(self, ind, level):
        if ind not in self.buys:
            self.buys[ind] = dict()
        buys_level = self.buys[ind]
        if level not in buys_level:
            buys_level[level] = dict()
        buys_times = buys_level[level]
        return buys_times

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
        dtt = self.datas[0].datetime
        dt = dt or dtt.date(0)
        tm = tm or dtt.time(0)
        print('%s, %s, %s' % (dt.isoformat(), tm, txt))


with open('../params.json', 'r') as f:
    params = json.load(f)
with open('../symbols.txt', 'r') as f:
    symbols = f.read().split(" ")

cerebro = bt.Cerebro(runonce=True)
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
utcnow = datetime.utcfromtimestamp(1666779300000 // 1000)
hist_start_date = utcnow - timedelta(minutes=60 * 24 * 90 * 1)
hist_end_date = utcnow - timedelta(minutes=60 * 24 * 3 * 1)
data0 = None

for v in symbols:
    data = store.getdata(dataname=v, name=v, market='future',
                     timeframe=bt.TimeFrame.Minutes, fromdate=hist_start_date, todate=hist_end_date,
                     compression=15, ohlcv_limit=1000, historical=True)
    # Add the feed
    data.plotinfo.plot = False
    cerebro.adddata(data)

# Run the strategy
cerebro.run()
for key in result_count:
    print('key:{}, value:{}'.format(key, result_count[key]))

for key in result_pnt_sum:
    print('key:{}, value:{}, win:{}, lose:{}, avg:{}'.format(key,
                                                             result_pnt_sum[key],
                                                             result_win[key],
                                                             result_lose[key],
                                                             result_pnt_sum[key]/(result_win[key] + result_lose[key])))
