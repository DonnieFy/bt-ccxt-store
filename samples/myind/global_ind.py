from __future__ import (absolute_import, division, print_function,
                        unicode_literals)

import backtrader as bt


class Global(bt.Indicator):
    """
    Helper inidcator for Supertrend indicator
    """
    params = (
        ('topn', 7),
        ('filter_change', 0.01)
    )
    lines = (
        'average',  # 全局平均涨幅
        'asc_topn_average',  # 涨幅前N平均
        'dec_topn_average',  # 跌幅前N平均
        'shock_topn_average',  # 振幅前n的平均涨幅
        'max',  # 最大涨幅
        'min',  # 最大跌幅
        'max_shock',  # 最大振幅
        'filter_inc_num',  # 上涨数量，大于filter_change
        'filter_dec_num'  # 下跌数量，小于负filter_change
        'pre_asc_topn_average',  # 昨日涨幅前N平均涨幅
        'pre_dec_topn_average',  # 昨日跌幅前N平均跌幅
        'pre_shock_topn_average',  # 昨日振幅前n的平均涨幅
    )

    def __init__(self):
        # 记录每次的涨跌振幅前n的索引，用于计算下个周期涨跌幅
        self.asc_topn = []
        self.dec_topn = []
        self.shock_topn = []

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
            change = (d.close[0] - d.open[0])/d.open[0]
            shock = (d.high[0] - d.low[0])/d.open[0]
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
            if change > self.p.filter_change:
                filter_inc_changes.append(change)
            elif change < -self.p.filter_change:
                filter_dec_changes.append(change)

            name = d._name
            if name in self.asc_topn:
                pre_asc_topn_changes.append(change)
            if name in self.dec_topn:
                pre_dec_topn_changes.append(change)
            if name in self.shock_topn:
                pre_asc_topn_shocks.append(change)

        # 计算昨日涨跌振幅前n的今日涨幅
        self.l.pre_asc_topn_average[0] = (sum(pre_asc_topn_changes)/len(pre_asc_topn_changes)) if len(pre_asc_topn_changes) > 0 else 0
        self.l.pre_dec_topn_average[0] = (sum(pre_dec_topn_changes)/len(pre_dec_topn_changes)) if len(pre_dec_topn_changes) > 0 else 0
        self.l.pre_shock_topn_average[0] = (sum(pre_asc_topn_shocks)/len(pre_asc_topn_shocks)) if len(pre_asc_topn_shocks) > 0 else 0

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
            if i < self.p.topn:
                idx = v[0]
                self.asc_topn.append(self.datas[idx]._name)
                asc_changes_sum += v[1]
            else:
                break
        for i, v in enumerate(sorted_dec_changes):
            if i < self.p.topn:
                idx = v[0]
                self.dec_topn.append(self.datas[idx]._name)
                dec_changes_sum += v[1]
            else:
                break
        for i, v in enumerate(sorted_shocks):
            if i < self.p.topn:
                idx = v[0]
                self.shock_topn.append(self.datas[idx]._name)
                shock_changes_sum += changes[v[0]]
            else:
                break

        # 计算全局平均，最大涨幅，最大跌幅，最大振幅
        self.l.average[0] = changes_sum/len(changes)
        self.l.max[0] = changes_max
        self.l.min[0] = changes_min
        self.l.max_shock[0] = shocks_max

        # 计算上涨数量，下跌数量
        self.l.filter_inc_num[0] = len(filter_inc_changes)
        self.l.filter_dec_num[0] = len(filter_dec_changes)

        # 计算topn涨跌震幅平均涨幅
        self.l.asc_topn_average[0] = asc_changes_sum/self.p.topn
        self.l.dec_topn_average[0] = dec_changes_sum/self.p.topn
        self.l.shock_topn_average[0] = shock_changes_sum/self.p.topn

        print('{}，市场平均涨幅:{}，上涨数量：{}，下跌数量：{}，涨幅前N平均：{}，跌幅前N平均：{}, 振幅前N平均：{}'.format(
            self.datas[0].datetime.datetime(),
            self.l.average[0], self.l.filter_inc_num[0], self.l.filter_dec_num[0],
            self.l.asc_topn_average[0], self.l.dec_topn_average[0], self.l.shock_topn_average[0]
        ))
        print('{}，最大涨幅:{}，最大跌幅：{}，最大振幅：{}'.format(
            self.datas[0].datetime.datetime(),
            self.l.max[0], self.l.min[0], self.l.max_shock[0]
        ))
        print('{}，昨日涨幅前N涨幅:{}，昨日跌幅前N涨幅：{}，昨日振幅前N涨幅：{}'.format(
            self.datas[0].datetime.datetime(),
            self.l.pre_asc_topn_average[0], self.l.pre_dec_topn_average[0], self.l.pre_shock_topn_average[0]
        ))
