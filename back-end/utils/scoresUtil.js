var mainController = require('../db/dbControllers/mainController')
var transactionQueue = require('../db/dbControllers/transactionQueue')
var _ = require('underscore')
var usefullVariables = require('./usefullVariables.js')

var daysInMonthByIndex = usefullVariables.daysInMonthByIndex
var monthIndexBy3Letters = usefullVariables.monthIndexBy3Letters


//The various get scores functions call the getScores controller method which returns an array
//populated with scoreObj's sorted by timestamp the array is then checked vs the time to return the
//relevant information to the client. In the future it might be usefull to combine some of this information
//to single days to limit the amount of information sent back to client.

//<h3>getScoresFromDaysAway</h3>

// returns the scores from x number of days into the past
var getScoresFromDaysAway = function(target_id, daysIntoPast, callback){
	//daysInMonthByIndex
	mainController.getScores(target_id, function(err, scoresObjs){
		if(err){
			callback(err)
		} else {
			var arrayOfScores = []
			var currentDate = new Date;
			var currentMonth = currentDate.getUTCMonth();
			var currentDay = currentDate.getUTCDate();

			var currentDayOfYear = dayOfYear(currentMonth, currentDay)
			if(currentDayOfYear <= daysIntoPast){
				currentDayOfYear += 365
			}
			//bellow is an array, the first elements has the current day being checked and the second is all of the scores for that day which will be averaged. The third element in the array will be a saved obj that will be used to store the averaged value and passed back to the user
			var singleDayValues = [-1,{"social":[],"currentScore":[]}]
			var scoreObj;
			for(var i = scoresObjs.length - 1; i >= 0 ; i--){
				scoreObj = scoresObjs[i];

				var scoreTime = scoreObj.ts.toString().split(" ")
				var scoreMonth = scoreTime[1]
				var scoreDay = Number([scoreTime[2]])
				var scoreDayOfYear = dayOfYear(scoreMonth, scoreDay)
				var scoreDiff = currentDayOfYear - scoreDayOfYear
				if(scoreDiff < 0 || (scoreDiff > daysIntoPast && scoreDiff < 365)){
					break;
				}
				delete scoreObj['social_investment']
				if(singleDayValues[0] === scoreDayOfYear){
					singleDayValues[1].social.push(scoreObj.social)
					singleDayValues[1].currentScore.push(scoreObj.currentScore)
					singleDayValues[2] = scoreObj
				}else{
					if(singleDayValues[1].social.length > 1){
						var yesterdaysScoreObj = singleDayValues[2]
						var sumScore = _.reduce(singleDayValues[1].social, function(a, b){return a + b})
						yesterdaysScoreObj.social = Math.round(sumScore / singleDayValues[1].social.length)
						sumScore = _.reduce(singleDayValues[1].currentScore, function(a, b){return a + b})
						yesterdaysScoreObj.currentScore = Math.round(sumScore / singleDayValues[1].currentScore.length)
						arrayOfScores.unshift(yesterdaysScoreObj)
					} else if(singleDayValues[2]){
						arrayOfScores.unshift(singleDayValues[2])
					}
					singleDayValues = [scoreDayOfYear,{"social":[scoreObj.social],"currentScore":[scoreObj.currentScore]}, scoreObj]
				}
			}
			arrayOfScores.unshift(scoreObj)
			callback(null, arrayOfScores)
		}
	})
}

//<h3>dayOfYear</h3>

//Returns an integer value for the day of the year
var dayOfYear = function(month, day){
	var dayOfYear = day
	if(typeof month === "string"){
		month = monthIndexBy3Letters[month]
	}
	for(var i = 0; i < month; i++){
		dayOfYear += daysInMonthByIndex[i]
	}
	return dayOfYear
}

//<h3>newSocialInvestmentScore</h3>

//Calculates the new social investment score based on supply, demand, number of shares on the market, and share velocity
var newSocialInvestmentScore = function(target_id) {

	var numInvestors;
	var sharesOnMarket = 0;
	var numTransactionsMade = 0;
	var newSocialInvestmentScore;
	var supply=0;
	var demand=0;
	mainController.findUserById(target_id, function(err, user) {
		if (err) {
			console.log('Error querying user by id', err);
		} else {
      user = user[0];
			mainController.targetTransactionHist(target_id, function(err, rows) {
				if (err) {
					console.log("There was an error", err);
				} else {
					numTransactionsMade = rows.length;
					mainController.getTargetStocks(target_id, function(err, stocks) {
						if (err) {
						} else {
							numInvestors = stocks.length;
							stocks.forEach(function(investment) {
                //Calculate total number of shares on market by totaling number of shares in each current investment
								sharesOnMarket+= investment.numberShares;
							})
              //Get the scores for the last week and store them in x,y format (x=index, y=score)
							mainController.getRecentScores(target_id, function (err, recentScores) {
								if (err) {
									console.log("There was an error getting recent scores", err);
								}
								else {
									var recentXVals = [];
									var recentYVals = [];
									_.each(recentScores,function (recentScore, index) {
										recentXVals.push(index);
                    recentYVals.push(recentScore.social_investment);
                  })
                  //Prevent score histories with only 1 value from breaking linear regression
                  if (recentXVals.length <2) {
                    recentXVals.push(recentXVals[0]);
                    recentYVals.push(recentYVals[0]);
                  }
                  //Get the scores for the last three months and treat as the general trend. Similar
                  //to recent scores, these values will also be placed in x,y format
                  mainController.getScoresLastThreeMonths(target_id, function (err, generalScores) {
                    var generalXVals = [];
                    var generalYVals = [];
                    _.each(generalScores, function (generalScore, index) {
                      generalXVals.push(index);
                      generalYVals.push(generalScore.social_investment);
                    })
                    if (generalXVals.length <2) {
                      generalXVals.push(generalXVals[0]);
                      generalYVals.push(generalYVals[0]);
                    }
                    //Calculate recent velocity
                    var recentVelocity = linearRegression(recentYVals, recentXVals).slope;
                    //If there is no velocity (activity in the last week), set the velocity to 0.
                    if (!recentVelocity) {
                    	recentVelocity = 0;
                    }

                    //Calculate general velocity
                    var generalVelocity = linearRegression(generalYVals, generalXVals).slope;

                    //Velocity is determined by giving greater weight to the recent velocity if it represents a great deviation
                    //from the general velocity
                    if (Math.abs(recentVelocity/generalVelocity) > 1.5 || Math.abs(generalVelocity/recentVelocity) > 1.5) {
                      velocity = recentVelocity * 0.75 + generalVelocity * 0.25;
                    } else {
                      velocity = recentVelocity * 0.5 + generalVelocity * 0.5;
                    }

                    //Search the transaction queue to find open buy and sell requests to determine supply and demand
                    transactionQueue.findOpenTransaction(target_id, 'buy', function (err, buyRequests) {
                      if (err) {
                        console.log("there was an error", err);
                      } else {
                        _.each(buyRequests, function (buyRequest) {
                          demand += buyRequest.numberShares;
                        })
                        transactionQueue.findOpenTransaction(target_id, 'sell', function (err, sellRequests) {
                          if (err) {
                            console.log("there was an error",err)
                          }
                          _.each(sellRequests, function (sellRequest) {
                            supply += sellRequest.numberShares;
                          })
                          social_investment_scores_object = {};
                          social_investment_scores_object.subscores = {
                            numShareHolder: numInvestors,
                            sharesOnMarket: sharesOnMarket,
                            numTransactions: numTransactionsMade
                          }
                          //Determine the new social investment score and update the score for the user
                          social_investment_scores_object.newSocialInvestmentScore = Math.sqrt(sharesOnMarket+demand-supply) * ((Math.atan(velocity) + Math.PI/2)*1.1);
                          updateScores(social_investment_scores_object, user)
                        })
                      }
                    })
                  })
								}
							})
						}
					})
				}
			})
		}
	})
}

//<h3>updateScores</h3>

//Stores the social_investment_subscores and social_investment_score of the user, and calculates a new currentScore
//from the new social_investment_score that is passed in for a specified user.
//Adds the scores to the scores history as well.
var updateScores = function(socialInvestmentScoresObj, user) {
  user.social_investment_subscores = JSON.stringify(socialInvestmentScoresObj.subscores);
	user.social_investment = socialInvestmentScoresObj.newSocialInvestmentScore;

	var gap = user.social - user.social_investment;
	var soc_weight = (user.social/(user.social + user.social_investment));
	var social_investment_weight = (1 - soc_weight);
	user.currentScore = Math.round(Math.sqrt(user.social_investment * user.social) + user.social);
	//add score to scores history
	var scoreObj = {
		user_id: user.id,
		social: user.social,
		social_investment: user.social_investment,
		currentScore: user.currentScore
	}
	mainController.addScore(scoreObj, user.social_investment_subscores, function(err, results) {
		if (err) {
			console.log("There was an error adding the score to scores' history", err);
		} else {
			console.log("Score was successfully added to scores' history");
		}
	})
}

//<h3>getScoresHistWithCurrentScores</h3>

//Provides a callback that can act on either the resultObj, an object containing all scores (current, social, social_investment)
//or the scoresObj from the scoresHist database.
var getScoresHistWithCurrentScores = function(user_id, callback){
	var testObj = {
		"social" : false,
		"social-investment" : false
	};
	var investmentTypes = {
		"social" : "social",
		"social-investment" : "social"
	}

	mainController.getScores(user_id, function(err, scoreObjs){
		var resultObj = {social:{}}

		var currentScore = 0;
		var currentIndex = scoreObjs.length - 1;

		if (currentIndex < 0) {
			callback(err, [])
		} else {
			//builds out the first two values for each score element
			while(!testTestObj(testObj)){
				console.log("what is type?", scoreObjs[currentIndex].type)
				var currentSubType = scoreObjs[currentIndex].type
				var currentInvestmentType = investmentTypes[currentSubType]
				if(!testObj[currentSubType]){
					testObj[currentSubType] = true
					resultObj[currentInvestmentType][currentSubType] = scoreObjs[currentIndex].score
				}
				currentIndex--;
			}
			addTotalsToResultObj(resultObj);
			callback(null, [resultObj, scoreObjs]);
		}
	})
}


//tests the test object
var testTestObj = function(testObj){
	for(var key in testObj){
		if(!testObj[key]){
			return false
		}
	}
	return true
}


var addTotalsToResultObj = function(resultObj){
	for(var key in resultObj){
	var total = 0;
	for(var subKey in resultObj[key]){
		total += resultObj[key][subKey]
	}
	resultObj[key].total = total
	}
}

//<h3>linearRegression</h3>

//Used to determine score velocity
function linearRegression(y,x){
		var lr = {};
		var n = y.length;
		var sum_x = 0;
		var sum_y = 0;
		var sum_xy = 0;
		var sum_xx = 0;
		var sum_yy = 0;

		for (var i = 0; i < y.length; i++) {

			sum_x += x[i];
			sum_y += y[i];
			sum_xy += (x[i]*y[i]);
			sum_xx += (x[i]*x[i]);
			sum_yy += (y[i]*y[i]);
		}

		lr['slope'] = (n * sum_xy - sum_x * sum_y) / (n*sum_xx - sum_x * sum_x);
		lr['intercept'] = (sum_y - lr.slope * sum_x)/n;
		lr['r2'] = Math.pow((n*sum_xy - sum_x*sum_y)/Math.sqrt((n*sum_xx-sum_x*sum_x)*(n*sum_yy-sum_y*sum_y)),2);

		return lr;
}

module.exports = {
	getScoresFromDaysAway: getScoresFromDaysAway,
	getScoresHistWithCurrentScores: getScoresHistWithCurrentScores,
	newSocialInvestmentScore: newSocialInvestmentScore,
	updateScores: updateScores
}
