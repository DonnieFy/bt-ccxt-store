/*
就是我刚开始编写机器人的源代码，几乎没有改动，参数也是原来的参数。这个版本的程序有许多
需要改进的地方，但即使如此，它也当时表现除了惊人的盈利能力，在我本金不多时，不加杠杆平
均每天盈利在5%左右。当然无论从哪一方面，它都不适应今天的市场。
我同时也发了一篇文章在社区，大家可以看看。
by 小草
*/

//稍微改了一下，用了平台的容错函数_C(),和精度函数_N().
//取消全部订单
function CancelPendingOrders() {
    var orders = _C(exchange.GetOrders);
    for (var j = 0; j < orders.length; j++) {
          exchange.CancelOrder(orders[j].Id, orders[j]);}
}

//计算将要下单的价格
function GetPrice(Type,depth) {
    var amountBids=0;
    var amountAsks=0;
    //计算买价，获取累计深度达到预设的价格
    if(Type=="Buy"){
       for(var i=0;i<20;i++){
           amountBids+=depth.Bids[i].Amount;
           //floatamountbuy就是预设的累计买单深度
           if (amountBids>floatamountbuy){
               //稍微加0.01，使得订单排在前面
              return depth.Bids[i].Price+0.01;}
        }
    }
    //同理计算卖价
    if(Type=="Sell"){
       for(var j=0; j<20; j++){
    	   amountAsks+=depth.Asks[j].Amount;
            if (amountAsks>floatamountsell){
            return depth.Asks[j].Price-0.01;}
        }
    }
    //遍历了全部深度仍未满足需求，就返回一个价格，以免出现bug
    return depth.Asks[0].Price
}
 
function onTick() {
    var depth=_C(exchange.GetDepth);
    var buyPrice = GetPrice("Buy",depth);
    var sellPrice= GetPrice("Sell",depth);
    //买卖价差如果小于预设值diffprice，就会挂一个相对更深的价格
    if ((sellPrice - buyPrice) <= diffprice){
            buyPrice-=10;
            sellPrice+=10;}
    //把原有的单子全部撤销，实际上经常出现新的价格和已挂单价格相同的情况，此时不需要撤销
    CancelPendingOrders() 
    //获取账户信息，确定目前账户存在多少钱和多少币
    var account=_C(exchange.GetAccount);
    //可买的比特币量
    var amountBuy = _N((account.Balance / buyPrice-0.1),2); 
    //可卖的比特币量，注意到没有仓位的限制，有多少就买卖多少，因为我当时的钱很少
    var amountSell = _N((account.Stocks),2); 
    if (amountSell > 0.02) {
        exchange.Sell(sellPrice,amountSell);}
    if (amountBuy > 0.02) {
        exchange.Buy(buyPrice, amountBuy);}
    //休眠，进入下一轮循环
    Sleep(sleeptime);
}
    
function main() {
    while (true) {
        onTick();
    }
}