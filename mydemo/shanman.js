// OKEX V5 获取总权益
function getTotalEquity_OKEX_V5() {
    var totalEquity = null 
    var ret = exchange.IO("api", "GET", "/api/v5/account/balance", "ccy=USDT")
    if (ret) {
        try {
            totalEquity = parseFloat(ret.data[0].details[0].eq)
        } catch(e) {
            Log("获取账户总权益失败！")
            return null
        }
    }
    return totalEquity
}

// 币安期货
function getTotalEquity_Binance() {
    var totalEquity = null 
    var ret = exchange.GetAccount()
    if (ret) {
        try {
            totalEquity = parseFloat(ret.Info.totalWalletBalance)
        } catch(e) {
            Log("获取账户总权益失败！")
            return null
        }
    }
    return totalEquity
}

// dYdX
function getTotalEquity_dYdX() {
    var totalEquity = null 
    var ret = exchange.GetAccount()
    if (ret) {
        totalEquity = ret.Balance
    }
    return totalEquity
}

function getTotalEquity() {
    var exName = exchange.GetName()
    if (exName == "Futures_OKCoin") {
        return getTotalEquity_OKEX_V5()
    } else if (exName == "Futures_Binance") {
        return getTotalEquity_Binance()
    } else if (exName == "Futures_dYdX") {
        return getTotalEquity_dYdX()
    } else {
        throw "不支持该交易所"
    }
}

function cancelAll() {
    while (1) {
        var orders = _C(exchange.GetOrders)
        if (orders.length == 0) {
            break
        }
        for (var i = 0 ; i < orders.length ; i++) {
            exchange.CancelOrder(orders[i].Id, orders[i])
            Sleep(500)
        }
        Sleep(500)
    }
}

function trade(distance, price, amount) {
    var tradeFunc = null 
    if (distance == "buy") {
        tradeFunc = exchange.Buy
    } else if (distance == "sell") {
        tradeFunc = exchange.Sell
    } else if (distance == "closebuy") {
        tradeFunc = exchange.Sell
    } else {
        tradeFunc = exchange.Buy
    }
    exchange.SetDirection(distance)
    return tradeFunc(price, amount)
}

function openLong(price, amount) {
    return trade("buy", price, amount)
}

function openShort(price, amount) {
    return trade("sell", price, amount)
}

function coverLong(price, amount) {
    return trade("closebuy", price, amount)
}

function coverShort(price, amount) {
    return trade("closesell", price, amount)
}

var buyOrderId = null
var sellOrderId = null

function main() {
    var exName = exchange.GetName()    
    // 切换OKEX V5模拟盘
    if (isSimulate && exName == "Futures_OKCoin") {
        exchange.IO("simulate", true)
    }

    if (isReset) {
        _G(null)
        LogReset(1)
        LogProfitReset()
        LogVacuum()
        Log("重置所有数据", "#FF0000")
    }

    exchange.SetContractType("swap")
    exchange.SetPrecision(pricePrecision, amountPrecision)
    Log("设置精度", pricePrecision, amountPrecision)

    if (totalEq == -1 && !IsVirtual()) {
        var recoverTotalEq = _G("totalEq")
        if (!recoverTotalEq) {
            var currTotalEq = getTotalEquity()
            if (currTotalEq) {
                totalEq = currTotalEq
                _G("totalEq", currTotalEq)
            } else {
                throw "获取初始权益失败"
            }
        } else {
            totalEq = recoverTotalEq
        }
    }

    while (1) {
        var ticker = _C(exchange.GetTicker)
        var pos = _C(exchange.GetPosition)
        if (pos.length > 1) {
            Log(pos)
            throw "同时有多空持仓"
        }
        // 根据状态而定
        if (pos.length == 0) {
            // 未持仓了，统计一次收益
            if (!IsVirtual()) {
                var currTotalEq = getTotalEquity()
                if (currTotalEq) {
                    LogProfit(currTotalEq - totalEq, "当前总权益：", currTotalEq)
                }
            }

            buyOrderId = openLong(ticker.Last - targetProfit, amount)
            sellOrderId = openShort(ticker.Last + targetProfit, amount)
        } else if (pos[0].Type == PD_LONG) {   // 有多头持仓
            var n = 1
            var price = ticker.Last
            buyOrderId = openLong(price - targetProfit * n, amount)
            sellOrderId = coverLong(pos[0].Price + targetProfit, pos[0].Amount)
        } else if (pos[0].Type == PD_SHORT) {   // 有空头持仓
            var n = 1
            var price = ticker.Last
            buyOrderId = coverShort(pos[0].Price - targetProfit, pos[0].Amount)
            sellOrderId = openShort(price + targetProfit * n, amount)
        }

        if (!sellOrderId || !buyOrderId) {
            cancelAll()
            buyOrderId = null 
            sellOrderId = null
            continue
        } 

        while (1) {  // 监控订单
            var isFindBuyId = false 
            var isFindSellId = false
            var orders = _C(exchange.GetOrders)
            for (var i = 0 ; i < orders.length ; i++) {
                if (buyOrderId == orders[i].Id) {
                    isFindBuyId = true 
                }
                if (sellOrderId == orders[i].Id) {
                    isFindSellId = true 
                }               
            }
            if (!isFindSellId && !isFindBuyId) {    // 买卖单都成交了
                cancelAll()
                break
            } else if (!isFindBuyId) {   // 买单成交
                Log("买单成交")
                cancelAll()
                break
            } else if (!isFindSellId) {  // 卖单成交
                Log("卖单成交")
                cancelAll()
                break
            }           
            
            if (!IsVirtual()) {
                var currTotalEq = getTotalEquity()
                var pos = exchange.GetPosition()
                if (currTotalEq && pos) {
                    // LogStatus(_D(), "当前总权益：", currTotalEq, "持仓：", pos)
                    var tblPos = {
                        "type" : "table",
                        "title" : "持仓",
                        "cols" : ["持仓数量", "持仓方向", "持仓均价", "持仓盈亏", "合约代码", "自定义字段 / " + SpecifyPosField],
                        "rows" : []
                    }
                    var descType = ["多头仓位", "空头仓位"]
                    for (var posIndex = 0 ; posIndex < pos.length ; posIndex++) {
                        tblPos.rows.push([pos[posIndex].Amount, descType[pos[posIndex].Type], pos[posIndex].Price, pos[posIndex].Profit, pos[posIndex].ContractType, SpecifyPosField == "" ? "--" : pos[posIndex].Info[SpecifyPosField]])
                    }
                    
                    var tbl = {
                        "type" : "table",
                        "title" : "数据",
                        "cols" : ["当前总权益", "实际盈亏", "当前价格", "买单价格/数量", "卖单价格/数量"],
                        "rows" : []
                    }
                    var buyOrder = null 
                    var sellOrder = null 
                    for (var orderIndex = 0 ; orderIndex < orders.length ; orderIndex++) {
                        if (orders[orderIndex].Type == ORDER_TYPE_BUY) {
                            buyOrder = orders[orderIndex]
                        } else {
                            sellOrder = orders[orderIndex]
                        }
                    }
                    var realProfit = currTotalEq - totalEq
                    if (exchange.GetName() == "Futures_Binance") {
                        _.each(pos, function(p) {
                            realProfit += parseFloat(p.Info.unRealizedProfit)
                        })                        
                    }
                    var t = exchange.GetTicker()
                    tbl.rows.push([currTotalEq, realProfit, t ? t.Last : "--", (buyOrder.Price + "/" + buyOrder.Amount), (sellOrder.Price + "/" + sellOrder.Amount)])
                    
                    // 更新图表数据             
                    if (t && showLine) {
                        _.each(pos, function(p) {
                            $.PlotLine(descType[p.Type] + "持仓价格", p.Price)
                        })
                        $.PlotLine("买单挂单价格", buyOrder.Price)
                        $.PlotLine("卖单挂单价格", sellOrder.Price)
                        $.PlotLine("当前价格", t.Last)
                    }
                    
                    // 更新状态栏数据
                    LogStatus("时间：" + _D() + "\n" + "`" + JSON.stringify(tblPos) + "`" + "\n" + "`" + JSON.stringify(tbl) + "`")
                }
            }            
            Sleep(5000)
        }
        Sleep(500)
    }
}

function onexit() {
    Log("扫尾，撤销所有挂单")
    cancelAll()
}