var app = null;

Ext.define('CustomApp', {
	extend: 'Rally.app.App',
	componentCls: 'app',

	seriesIterationPlanned : 1,
	seriesIterationAccepted : 2,
	seriesRemaining : 3,
	seriesPlanned : 4,
	seriesRegressionAccepted : 5,
	seriesRegressionPlanned : 6,
	seriesIdeal : 7,

	ui : function() {

		var button = Ext.create('Ext.Container', {
			items: [{
				xtype: 'rallybutton',
				text: 'Select',
				handler: function() {
					var chooser  = Ext.create('Rally.ui.dialog.ChooserDialog', {
						artifactTypes: ['userstory','portfolioitem'],
						autoShow: true,
						height: 250,
						title: 'Choose User Stories',
						listeners: {
						artifactChosen: function(selectedRecord){
							Ext.Msg.alert('Chooser', selectedRecord.get('Name') + ' was chosen');
						},
						scope: this
						}
					});
				}
			}]		
		});

		app.add(button);

	},

	launch: function() {
		app = this;

		app.ui();

		async.waterfall([ 
			app.queryReleases,
			app.queryIterations,
			app.queryChildSnapshots,
			app.queryEpicSnapshots,
			app.createChartSeries,
			app.showChart
		], 
        function(err,results){
        	console.log("err",err);
        	console.log("results",results);
        });
	},

	queryReleases : function(callback) {

		var startReleaseName = app.getSetting("startRelease");
		var endReleaseName   = app.getSetting("endRelease");
		var epicStoryId = app.getSetting("epicStoryId");

		var configs = [];
		configs.push({ 	
			model : "Release",
			fetch : true,
			filters : [ { property:"Name", operator:"=", value:startReleaseName} ]
		});
		configs.push({ 	
			model : "Release",
			fetch : true,
			filters : [ { property:"Name", operator:"=", value:endReleaseName} ]
		});
		configs.push({ 	
			model : app.getSetting("typeName") === "Story" ? "HierarchicalRequirement" : app.getSetting("typeName"), //"artifact",
			fetch : ["ObjectID","FormattedID","Name","PlanEstimate","LeafStoryPlanEstimateTotal"],
			filters : [ { property:"FormattedID", operator:"=", value: epicStoryId} ]
		});

		async.map( configs, app.wsapiQuery, function(err,results) {

			if (results[0].length === 0 || results[1].length === 0) {
				app.add({html:"Unable to find start or end release"});  			
			} else if (results[2].length===0) {
				app.add({html:"Unable to find Item id:" + epicStoryId});  			
			} else {
				app.epicStory = results[2][0];
				console.log("Epic",app.epicStory);
				// do something with the two results
				var r1 = results[0][0].raw.ReleaseStartDate;
				var r2 = results[1][0].raw.ReleaseDate;
				app.releaseExtent = { start : r1, end : r2};

				var configs = [];
				configs.push({ 	
					model : "Release",
					fetch : true,
					filters : [ 
						{ property:"ReleaseStartDate", operator:">=", value : r1 },
						{ property:"ReleaseDate", operator:"<=", value : r2 }
					]
				});

				async.map( configs, app.wsapiQuery, function(err,results) {
					app.releases = results[0];
					callback();
				});
			}
		});
	},

	queryIterations : function(callback) {

		var configs = [];
		configs.push({ 	
			model : "Iteration",
			fetch : true,
			filters : [
				{ property:"StartDate", operator:">=", value : app.releaseExtent.start },
				{ property:"EndDate", operator:"<=", value : app.releaseExtent.end }
			]
		});
		async.map( configs, app.wsapiQuery, function(err,results) {	
			app.iterations = results[0];
			app.conIterations = app.consolidateTimeboxByName(app.iterations);
			app.conIterations = _.sortBy(app.conIterations,function(i) {
				return Rally.util.DateTime.fromIsoString(i.raw.EndDate)
			});
			callback();
			// app.queryChildSnapshots();
		});
	},

	queryChildSnapshots : function(callback) {

		var epicObjectID = app.epicStory.get("ObjectID");

		var storeConfig = {
			find : {
				'_TypeHierarchy' : { "$in" : ["HierarchicalRequirement"] },
				'_ItemHierarchy' : { "$in" : [epicObjectID] },
				'__At' : 'current',
				'Children' : null
			},
			fetch: ['_ItemHierarchy','_UnformattedID','ObjectID','ScheduleState','PlanEstimate','Iteration','Name'],
			hydrate: ['ScheduleState']
		};

		async.map( [storeConfig], app.snapshotQuery,function(err,results){
			app.ChildSnapshots = results[0];
			console.log("child snapshots",app.ChildSnapshots.length);
			callback();
		});

	},

	// includes history information.
	queryEpicSnapshots : function(callback) {

		var epicObjectID = app.epicStory.get("ObjectID");

		var storeConfig = {
			find : {
				'ObjectID' : epicObjectID
			},
			fetch: ['_ItemHierarchy','_UnformattedID','ObjectID','ScheduleState','PlanEstimate','LeafStoryPlanEstimateTotal'],
			hydrate: ['ScheduleState']
		};

		async.map( [storeConfig], app.snapshotQuery,function(err,results){
			var epicSnapshots = results[0];
			console.log("epicSnapshots",epicSnapshots.length,epicSnapshots);
			app.scopeSeries = app.lumenizeScope(epicSnapshots);
			console.log("epicScopeSeries",app.scopeSeries);
			
			callback();
		});

	},

	lumenizeScope : function(snapshots) {

        var lumenize = window.parent.Rally.data.lookback.Lumenize;

		var calc = Ext.create("EpicSummaryCalculator",config);
        // calculator config
        var config = {
            deriveFieldsOnInput: [],
            metrics: [
                {
                    field : app.getSetting("typeName")==="Story" ? 'PlanEstimate' : 'LeafStoryPlanEstimateTotal',
                    as : "Scope",
                    f : "sum"
                }
            ],
            summaryMetricsConfig: [],
            deriveFieldsAfterSummary: [],
            granularity: 'day',
            tz: 'America/Chicago',
            holidays: [],
            workDays: 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'
        };

        var t1 = new lumenize.Time(app.releaseExtent.start,'day',"America/New_York") //.getISOStringInTZ(config.tz);
        var t2 = new lumenize.Time(app.releaseExtent.end,'day',"America/New_York") //.getISOStringInTZ(config.tz);
        calculator = new lumenize.TimeSeriesCalculator(config);
        // console.log(app.releaseExtent);
        calculator.addSnapshots(_.map(snapshots,function(s){return s.data}), t1,t2);
        
        // create a high charts series config object, used to get the hc series data
        var hcConfig = [ { name : "label" }, { name : "Scope"} ] ;
        var hc = lumenize.arrayOfMaps_To_HighChartsSeries(calculator.getResults().seriesData, hcConfig);

        // get the values just for iteration dates.
        var series = [];
        _.each( app.conIterations, function(i) {
        	var idx = _.findIndex( hc[0].data, function(d) {
        		return moment(d).isSame( moment(i.raw.EndDate), "day");
        	});
        	series.push(hc[1].data[idx]);
        });
        return series;

	},

	timeboxName : function(timebox) {
		var d = Rally.util.DateTime.fromIsoString( 
			timebox.get("_type") === 'iteration' ?
				timebox.raw.EndDate : 
				timebox.raw.ReleaseDate
		);
		var name = timebox.get("Name") + " (" + (d.getMonth()+1) + "/" + d.getDate() + ")";
		return name;
	},

	consolidateTimeboxByName : function(timeboxes) {
		var groups = _.groupBy(timeboxes,function(i) {
			// return i.get("Name");
			return app.timeboxName(i)
		});
		var values = _.values(groups);
		var consolidated = _.map(values,function(v) { return v[0];});
		return consolidated;
	},

	lastReleaseIteration : function(release) {
		var iterations = _.filter(app.conIterations, function (i) {
			var id = Rally.util.DateTime.fromIsoString(i.raw.EndDate);
			var rsd = Rally.util.DateTime.fromIsoString(release.raw.ReleaseStartDate);
			var red = Rally.util.DateTime.fromIsoString(release.raw.ReleaseDate);
			return (( id >= rsd) && (id <= red));
		});
		iterations = _.sortBy(iterations,function(i) { return i.get("EndDate");});
		return _.last(iterations);
	},

	validValue : function(value) {
		return !_.isUndefined(value) && !_.isNull(value) && value !== '';
	},

	iterationSnapshots : function(conIteration) {

		var iterations = _.filter(app.iterations, function(ai) {
			return app.timeboxName(ai) === app.timeboxName(conIteration);
		});

		var iterationIds = _.map(iterations,function(i) {
			return i.get("ObjectID");
		});

		var iterationSnapShots = _.filter(app.ChildSnapshots, function(s) {
			return _.indexOf(iterationIds,s.get("Iteration")) !== -1;
		});

		return iterationSnapShots;
	},

	currentIterationIdx : function() {
		var today = new Date();
		var currentIterationIdx = _.findIndex( app.conIterations, function(i) {
			return (today >= Rally.util.DateTime.fromIsoString(i.raw.StartDate)) &&
				(today <= Rally.util.DateTime.fromIsoString(i.raw.EndDate))
		});
		return currentIterationIdx;
	},

	nullifyTrailingZeroValues : function(arr) {

		var idx = _.findLastIndex(arr,function(e) {
			return e > 0;
		});

		return _.map(arr,function(e,x) {
			return x < idx+1 ? e : null;
		});

	},

	getEpicEstimateTotal : function() {
		// if story return PlanEstimate
		if (app.epicStory.get("_Type")==="HierarchicalRequirement")
			return app.epicStory.get("PlanEstimate")
		else
			return app.epicStory.get("LeafStoryPlanEstimateTotal")
	},

	createChartSeries : function(callback) {
		var series = [];

		var currentIdx = app.currentIterationIdx();
		var undefinedPoints = _.reduce( app.ChildSnapshots,function(sum,s){
			return sum + ( !app.validValue(s.get("Iteration")) ? s.get("PlanEstimate") : 0 )
		},0);
		var undefinedCount = _.reduce( app.ChildSnapshots,function(sum,s){
			return sum + ( !app.validValue(s.get("Iteration")) ? 1 : 0 )
		},0);

		var allAccepted = _.reduce( app.ChildSnapshots,function(sum,s){
			return sum + (s.get("ScheduleState")==="Accepted" ? s.get("PlanEstimate") : 0);
		},0);
		var allAcceptedCount = _.reduce( app.ChildSnapshots,function(sum,s){
			return sum + (s.get("ScheduleState")==="Accepted" ? 1 : 0);
		},0);


		// labels (iteration names)
		series.push( {
			data : _.map( app.conIterations, function(i) {
				// return i.get("Name");
				return app.timeboxName(i);
			})
		});

		// iteration planned 
		series.push( {
			name : 'planned',
			type : 'column',
			data : _.map( app.conIterations, function(i) {
				
				var planned = _.reduce( app.iterationSnapshots(i), function(sum,s) {
					return sum + s.get("PlanEstimate");
				},0);

				return planned;
			})
		});

		var lastPlannedIdx = 
			_.findLastIndex(series[app.seriesIterationPlanned].data, function(v) {
				return v > 0;
			});

		// iteration accepted
		series.push( {
			name : 'Accepted',
			type : 'column',
			data : _.map( app.conIterations, function(i) {
				
				var accepted = _.reduce( app.iterationSnapshots(i), function(sum,s) {
					return sum + (s.get("ScheduleState")==="Accepted" ? s.get("PlanEstimate") : 0);
				},0);
				return accepted > 0 ? accepted : null;
			})
		});

		var previouslyAccepted = allAccepted - ( 
			_.reduce(series[app.seriesIterationAccepted].data,function(sum,v) { return sum + v; } ,0)
		);

		// remaining
		series.push( {
			name : 'Remaining',
			data : _.map( app.conIterations, function(i,x) {

				if ( currentIdx!==-1 && x >= currentIdx) {
					return null;
				} else {
					return app.getEpicEstimateTotal() -
						previouslyAccepted -
						_.reduce( series[app.seriesIterationAccepted].data.slice(0,x), function(sum,v) { 
							return sum + v;
						},0);
				}
			})
		});
		
		// planned
		series.push( {
			name : 'Planned',
			dashStyle: 'dash',
			data : _.map( app.conIterations, function(i,x) {

				if ( currentIdx!==-1 && (x < currentIdx-1 || x > lastPlannedIdx)) {
					return null;
				} else {
					return app.getEpicEstimateTotal() -
						previouslyAccepted -
						_.reduce( series[app.seriesIterationAccepted].data.slice(0,x), function(sum,v) { 
							return sum + v;
						},0) -
						_.reduce( series[app.seriesIterationPlanned].data.slice(currentIdx,x+1), function(sum,v) {
							return sum + v;
						},0);
				}
			})
		});

		// regression(accepted)
		series.push( {
			name : 'Regression(Accepted)',
			dashStyle: 'Dot',
			data : function(){
				// var a = _.compact(series[app.seriesIterationAccepted].data);
				var a = _.map(series[app.seriesIterationAccepted].data,function(v,x){
					return [x,v];
				});
				var result = regression('linear', a);
				var d = _.map(series[app.seriesIterationAccepted].data,function(v,x) {
					if (x < lastPlannedIdx) {
						return null;
					} else {
						var projected = _.map( result.points.slice(lastPlannedIdx,x), function(p) { return p[1];});
						var val = series[app.seriesPlanned].data[lastPlannedIdx] - 
							_.reduce(projected,function(sum,v) {
								return sum + v;
							},0);
						return val > 0 ? val : 0;
					}
				});
				return app.nullifyTrailingZeroValues(d);
			}()
		});

		series.push( {
			name : 'Regression(Planned)',
			dashStyle: 'Dot',
			data : function(){
				var a = _.map(series[app.seriesIterationAccepted].data,function(v,x){
					if (x < currentIdx) {
						return [ x, series[app.seriesIterationAccepted].data[x]];
					} else {
						return [x, series[app.seriesIterationPlanned].data[x]];
					}
				});
				var result = regression('linear', a);
				var d = _.map(series[app.seriesIterationAccepted].data,function(v,x) {
					if (x < lastPlannedIdx) {
						return null;
					} else {
						var projected = _.map( result.points.slice(lastPlannedIdx,x), function(p) { return p[1];});
						var val = series[app.seriesPlanned].data[lastPlannedIdx] - 
							_.reduce(projected,function(sum,v) {
								return sum + v;
							},0);
						return val > 0 ? val : 0;
					}
				});
				return app.nullifyTrailingZeroValues(d);
			}()
		});

		// ideal
		series.push( {
			name : 'Ideal',
			zIndex : -1,
			// dashStyle: 'dot',
			data : function() {
				var startValue = app.epicStory.get("PlanEstimate") - previouslyAccepted;
				var stepValue = startValue / ( app.conIterations.length - (parseInt(app.getSetting("hardeningSprints"))+1));
				var arr = [];
				for ( var x = 0 ; x < app.conIterations.length ; x++) {
					var ideal = (startValue - (x * stepValue));
					arr.push( ideal > 0 ? ideal : null);
				}
				arr[ _.findIndex(arr,function(a){return a===null})] = 0;
				return arr;
			}()
		});

		// scope
		series.push( {
			name : 'Scope',
			zIndex : -2,
			data : app.scopeSeries
		});

		callback(null,series);

	},

	showChart : function(series,callback) {

		var chart = app.down("#chart1");
		if (chart !== null)
			chart.removeAll();
			
		// create plotlines
		var plotlines = app.createPlotLines(series);
		
		// set the tick interval
		var tickInterval = series[1].data.length <= (25) ? 1 : Math.ceil((series[1].data.length / 25));

		var extChart = Ext.create('Rally.ui.chart.Chart', {
			columnWidth : 1,
			itemId : "chart1",
			chartData: {
				categories : series[0].data,
				series : series.slice(1, series.length)
			},

			// blue, green, lt green,
		   	chartColors: ['#99d8c9', '#2ca25f', '#2b8cbe','#a6bddb', '#a8ddb5', '#d0d1e6', '#bdbdbd','#e0e0e0' ],
			// chartColors : createColorsArray(series),

			chartConfig : {
				chart: {
				},
				title: {
				text: app.epicStory.get("FormattedID")+ " : " + app.epicStory.get("Name"),
				x: -20 //center
				},
				plotOptions: {
					series: {
						marker: {
							radius: 3
						}
					}
				},
				xAxis: {
					tickInterval : tickInterval,
					plotLines : plotlines,
					labels: {
						// y : 50,
                    	// rotation: -45,
	                    style: {
	                        fontSize: '10px',
	                        // fontFamily: 'Verdana, sans-serif'
                    }
                }
				},
				yAxis: {
					title: {
						text: 'Points'
					}
				},
				tooltip: {
				},
				legend: { align: 'center', verticalAlign: 'bottom' }
			}
		});
		app.add(extChart);
		var p = Ext.get(extChart.id);
		elems = p.query("div.x-mask");
		_.each(elems, function(e) { e.remove(); });
		var elems = p.query("div.x-mask-msg");
		_.each(elems, function(e) { e.remove(); });

		callback(null,series);
	},

	createPlotLines : function(seriesData) {

		var plotLines = [];

		// filter the iterations
		var iterationPlotLines = 
			_.map(seriesData[0].data, function(i,x){
			return {
				// label : { text : i} ,
				dashStyle : "Dot",
				color: 'grey',
				width: 1,
				// value: _.indexOf(seriesData,d)
				value : x
			}; 
		});

		// create release plot lines        
		app.conReleases = app.consolidateTimeboxByName(app.releases);

		var releasePlotLines = _.map(app.conReleases,function(r) {
			var iteration = app.lastReleaseIteration(r);
			if (_.isUndefined(iteration)||_.isNull(iteration)) {
				return {};
			} else {
				var index = _.indexOf( seriesData[0].data, app.timeboxName(iteration)); // iteration.get("Name"));
				return {
						// dashStyle : "Dot",
					label : { 
						text : app.timeboxName(r),
	                    style: {
	                        fontSize: '10px'
	                    }
					}, //  r.get("Name")} ,
					color: 'grey',
					width: 1,
					value: index
				}; 
			}
		});

		plotLines = _.uniq(plotLines,function(p) { return p.value; });

		var idx = app.currentIterationIdx();
		if (idx!==-1) {
			plotLines.push({
					dashStyle : "Dot",
					label : { text : "Current"} ,
					color: 'blue',
					width: 2,
					value: idx
			});
						
		}
		return plotLines.concat(iterationPlotLines).concat(releasePlotLines);
	},

	config: {
		// defaultSettings : {
		// 	typeName : "Story",
		// 	startRelease : "Release 1",
		// 	endRelease : "Release 9",
		// 	hardeningSprints : "1",
		// 	epicStoryId : "US14919"
		// }
		// defaultSettings : {
		// 	typeName : "PortfolioItem/Goal",
		// 	startRelease : "Release 1",
		// 	endRelease : "Release 9",
		// 	hardeningSprints : "1",
		// 	epicStoryId : "G1076"
		// }
		defaultSettings : {
			typeName : "PortfolioItem/Initiative",
			startRelease : "ALM Q1 Feature Release",
			endRelease : "2014 Q2",
			hardeningSprints : "1",
			epicStoryId : "I3032"
		}

	},

	getSettingsFields: function() {

		var values = [
			{
				name: 'typeName',
				xtype: 'rallytextfield',
				label : 'Type of Epic eg. "Story" or "PortfolioItem/Feature" or "PortfolioItem/Initiative" etc.'
			},

			{
				name: 'epicStoryId',
				xtype: 'rallytextfield',
				label : "Epic Story ID eg. 'US921'"
			},

			{
				name: 'startRelease',
				xtype: 'rallytextfield',
				label : "First Release Name in Chart Range"
			},
			{
				name: 'endRelease',
				xtype: 'rallytextfield',
				label : "Last Release Name in Chart Range"
			},
			{
				name: 'hardeningSprints',
				xtype: 'rallytextfield',
				label : "Number of Hardening Sprints"
			},

		];

		return values;
	},

	// generic function to perform a web services query    
	wsapiQuery : function( config , callback ) {

		Ext.create('Rally.data.WsapiDataStore', {
			autoLoad : true,
			limit : "Infinity",
			model : config.model,
			fetch : config.fetch,
			filters : config.filters,
			listeners : {
				scope : this,
				load : function(store, data) {
					callback(null,data);
				}
			}
		});

	},

	snapshotQuery : function( config ,callback) {

		var storeConfig = {
			find    : config.find,
			fetch   : config.fetch,
			hydrate : config.hydrate,
			autoLoad : true,
			pageSize : 10000,
			limit    : 'Infinity',
			listeners : {
				scope : this,
				load  : function(store,snapshots,success) {
					callback(null,snapshots);
				}
			}
		};
		var snapshotStore = Ext.create('Rally.data.lookback.SnapshotStore', storeConfig);

	}

});
