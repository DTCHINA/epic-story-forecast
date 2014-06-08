var app = null;

Ext.define('CustomApp', {
	extend: 'Rally.app.App',
	componentCls: 'app',
	// items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc2/doc/">App SDK 2.0rc2 Docs</a>'},

	seriesIterationPlanned : 1,
	seriesIterationAccepted : 2,
	seriesRemaining : 3,
	seriesPlanned : 4,
	seriesRegressionAccepted : 5,
	seriesRegressionPlanned : 6,
	seriesIdeal : 7,

	launch: function() {
		app = this;
		//Write app code here
		app.queryReleases();
	},

	queryReleases : function() {

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
			model : "HierarchicalRequirement",
			fetch : ["ObjectID","FormattedID","Name","PlanEstimate"],
			filters : [ { property:"FormattedID", operator:"=", value: epicStoryId} ]
		});


		async.map( configs, app.wsapiQuery, function(err,results) {


			if (results[0].length === 0 || results[1].length === 0) {
				app.add({html:"Unable to find start or end release"});  			
			} else if (results[2].length===0) {
				app.add({html:"Unable to find story id:" + epicStoryId});  			
			} else {
				app.epicStory = results[2][0];
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
					app.queryIterations();
				});
			}
		});
	},

	queryIterations : function() {

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
			app.queryChildSnapshots();

		});

	},

	queryChildSnapshots : function() {

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
			// console.log("snapshot names:",_.map(results[0],function(s){return s.get("Name");}));
			app.ChildSnapshots = results[0];
			app.createChartSeries();
		});

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
		console.log("groups",groups);
		var values = _.values(groups);
		var consolidated = _.map(values,function(v) { return v[0];});
		console.log("consolidated",consolidated);
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
			// return ai.get("Name") === conIteration.get("Name");
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

	createChartSeries : function() {
		var series = [];

		app.conIterations = app.consolidateTimeboxByName(app.iterations);
		app.conIterations = _.sortBy(app.conIterations,function(i) {
			return Rally.util.DateTime.fromIsoString(i.raw.EndDate)
		});

		var currentIdx = app.currentIterationIdx();
		var undefinedPoints = _.reduce( app.ChildSnapshots,function(sum,s){
			return sum + ( !app.validValue(s.get("Iteration")) ? s.get("PlanEstimate") : 0)
		},0);

		var allAccepted = _.reduce( app.ChildSnapshots,function(sum,s){
			return sum + (s.get("ScheduleState")==="Accepted" ? s.get("PlanEstimate") : 0);
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
					return app.epicStory.get("PlanEstimate") -
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
					return app.epicStory.get("PlanEstimate") -
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
				// console.log(a);
				var result = regression('linear', a);
				var d = _.map(series[app.seriesIterationAccepted].data,function(v,x) {
					if (x < lastPlannedIdx) {
						return null;
					} else {
						var projected = _.map( result.points.slice(lastPlannedIdx,x), function(p) { return p[1];});
						// console.log("x,Projected,rem",x,projected,series[app.seriesPlanned].data[lastPlannedIdx]);

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
				console.log(startValue,stepValue);
				var arr = [];
				for ( var x = 0 ; x < app.conIterations.length ; x++) {
					var ideal = (startValue - (x * stepValue));
					arr.push( ideal > 0 ? ideal : null);
				}
				arr[ _.findIndex(arr,function(a){return a===null})] = 0;
				return arr;
			}()
		});

		app.showChart(series);

	},

	showChart : function(series) {

		var that = this;
		var chart = this.down("#chart1");
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

		   //chartColors: ['Gray', 'Orange', 'LightGray', 'LightGray', 'LightGray', 'Blue','Green'],
		 	// seriesIterationPlanned : 1,
			// seriesIterationAccepted : 2,
			// seriesRemaining : 3,
			// seriesPlanned : 4,
			// seriesProjected : 5,
			// seriesIdeal : 6,

			// blue, green, lt green,
		   chartColors: ['#99d8c9', '#2ca25f', '#2b8cbe','#a6bddb', '#a8ddb5', '#d0d1e6', '#bdbdbd' ],
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
		this.add(extChart);
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
		defaultSettings : {
			startRelease : "Release 1",
			endRelease : "Release 9",
			hardeningSprints : "1",
			// epicStoryId : "US104028"
			epicStoryId : "US14919"
			// ignoreZeroValues        : true,
			// PreliminaryEstimate     : true,
			// StoryPoints             : true,
			// StoryCount              : false,
			// StoryPointsProjection   : true,
			// StoryCountProjection    : false,
			// AcceptedStoryPoints     : true,
			// AcceptedStoryCount      : false,
			// AcceptedPointsProjection: true,
			// AcceptedCountProjection : false,
			// FeatureCount            : false,
			// FeatureCountCompleted   : false
		}
	},

	getSettingsFields: function() {

		var values = [
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
