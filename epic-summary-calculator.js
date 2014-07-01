Ext.define("EpicSummaryCalculator", function() {

    var self;

    return {

        extend: "Rally.data.lookback.calculator.TimeSeriesCalculator",

        config : {
        },

        constructor:function(config) {
            self = this;
            this.initConfig(config);
            return this;
        },

        getMetrics: function () {


            var metrics = [
                {
                    field : "PlanEstimate",
                    as : "Scope",
                    f : "sum"
                }
            ]

            return metrics;
        },

        getDerivedFieldsOnInput : function () {
            // XS 1, S 3, M 5, L 8, XL 13
            return [];
        },

        getDerivedFieldsAfterSummary : function () {

            return [];
        }

    };
   
});
