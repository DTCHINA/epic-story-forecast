epic-story-forecast
=========================

## Overview

In [SAFe](http://scaledagileframework.com/) Programs Epics are delivered over multiple PSI releases. This apps visualizes the progress of the stories associated with a specific Epic over those releases. 

There are 3 main elements to the chart :-

__Remaining__ Represents work done to date. The solid line shows the work remaining in points for stories associated with the Epic

__Planned__ The dotted line shows future progress based on stories planned into specific iterations.

__Regression__ There are two regression lines for the remaining unplanned work. The Accepted regression line is a projection based on acceptance rate todate. The Planned regression is a projection based on a combination of accepted and future planned work. 

The __Ideal Line__ is a straightline burndown based on the total story points for this epic at the beginning of the timebox. It can be adjusted based on a specified number of hardening iterations.


![alt text](https://raw.githubusercontent.com/wrackzone/epic-story-forecast/master/doc/screenshot.png)

In addition there are a number of other visual elements :-

__Dotted vertical lines__ represent each iteration boundary. 

__Solid vertical lines__ represent PSI Releases.

The __Planned__ column represents planned story points for that iteration. The __Accepted__ column represents story points accepted in that iteration.




## License

AppTemplate is released under the MIT license.  See the file [LICENSE](./LICENSE) for the full text.

##Documentation for SDK

You can find the documentation on our help [site.](https://help.rallydev.com/apps/2.0rc2/doc/)
