var app = null;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc2/doc/">App SDK 2.0rc2 Docs</a>'},
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
	    			console.log("all releases",results[0].length,results[0]);
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

    		console.log("iterations",results[0]);
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
        	console.log("snapshots:",results[0]);
        	console.log("snapshot names:",_.map(results[0],function(s){return s.get("Name");}));
        	app.ChildSnapshots = results[0];
        	app.createChartSeries();
        });

    },

    consolidateTimeboxByName : function(timeboxes) {
    	var groups = _.groupBy(timeboxes,function(i) {
    		return i.get("Name");
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
			return ai.get("Name") === conIteration.get("Name");
		});

		var iterationIds = _.map(iterations,function(i) {
			return i.get("ObjectID");
		});

		var iterationSnapShots = _.filter(app.ChildSnapshots, function(s) {
			return _.indexOf(iterationIds,s.get("Iteration")) !== -1;
		});

		return iterationSnapShots;
    },

    createChartSeries : function() {
    	var series = [];

    	app.conIterations = app.consolidateTimeboxByName(app.iterations);

    	series.push( {
    		data : _.map( app.conIterations, function(i) {
    			return i.get("Name");
			})
    	});

    	series.push( {
    		name : 'random values',
    		// type : 'area',
    		data : _.map( app.conIterations, function(i) {
    			return Math.floor((Math.random() * 100) + 1);;
			})
    	});

    	var undefinedPoints = _.reduce( app.ChildSnapshots,function(sum,s){
    		console.log("s",s,!app.validValue(s.get("Iteration")));
    		return sum + ( !app.validValue(s.get("Iteration")) ? s.get("PlanEstimate") : 0)
    	},0);

    	console.log("Undefined",undefinedPoints);

    	series.push( {
    		name : 'planned',
    		// type : 'area',
    		data : _.map( app.conIterations, function(i) {
    			
    			var planned = _.reduce( app.iterationSnapshots(i), function(sum,s) {
    				return sum + s.get("PlanEstimate");
    			},0);
    			console.log("Planned",planned);

    			return planned;
			})
    	});

    	series.push( {
    		name : 'accepted',
    		// type : 'area',
    		data : _.map( app.conIterations, function(i) {
    			
    			var accepted = _.reduce( app.iterationSnapshots(i), function(sum,s) {
    				// console.log("accepted?",s.get("ScheduleState")==="Accepted",s.get("PlanEstimate"),s);
    				return sum + (s.get("ScheduleState")==="Accepted" ? s.get("PlanEstimate") : 0);
    			},0);
    			return accepted;
			})
    	});



    	console.log("series",series);
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
        var tickInterval = series[1].data.length <= (7*20) ? 7 : (series[1].data.length / 20);

        // series[1].data = _.map(series[1].data, function(d) { return _.isNull(d) ? 0 : d; });

        var extChart = Ext.create('Rally.ui.chart.Chart', {
            columnWidth : 1,
            itemId : "chart1",
            chartData: {
                categories : series[0].data,
                series : series.slice(1, series.length)
            },

           //chartColors: ['Gray', 'Orange', 'LightGray', 'LightGray', 'LightGray', 'Blue','Green'],
           chartColors: ['#e0f3db', '#a8ddb5', '#43a2ca'],
            // chartColors : createColorsArray(series),

            chartConfig : {
                chart: {
                },
                title: {
                text: '',
                x: -20 //center
                },
                plotOptions: {
                    series: {
                        marker: {
                            radius: 5
                        }
                    }
                },
                xAxis: {
                    plotLines : plotlines,
                    type: 'datetime',
                },
                yAxis: {
                    title: {
                        text: 'Points'
                    },
                    // plotLines: [{
                    // 	dashStyle : "Dot",
                    //     // value: 0,
                    //     width: 1,
                    //     color: '#808080'
                    // }]
                },
                tooltip: {
                },
                legend: { align: 'center', verticalAlign: 'bottom' }
            }
        });
        this.add(extChart);
    },

    createPlotLines : function(seriesData) {

        // filter the iterations
        var itPlotLines = _.map(seriesData[0].data, function(i,x){
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

        var rePlotLines = _.map(app.conReleases,function(r) {
        	var iteration = app.lastReleaseIteration(r);
        	if (_.isUndefined(iteration)||_.isNull(iteration)) {
        		return {};
        	} else {
        		var index = _.indexOf( seriesData[0].data, iteration.get("Name"));
	        	return {
		                // dashStyle : "Dot",
					label : { text : r.get("Name")} ,
	                color: 'grey',
	                width: 1,
	                value: index
	            }; 
	        }
        });
        return itPlotLines.concat(rePlotLines);

    },

    config: {
        defaultSettings : {
            startRelease : "Release 1",
            endRelease : "Release 7",
            hardeningSprints : 0,
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
                label : "First Relase in Chart Range"
            },
            {
                name: 'endRelease',
                xtype: 'rallytextfield',
                label : "Last Relase in Chart Range"
            },
            {
                name: 'hardeningSprints',
                xtype: 'rallytextfield',
                label : "Last Relase in Chart Range"
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
