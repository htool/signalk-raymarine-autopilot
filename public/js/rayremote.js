/*
 * Copyright 2019 Christian MOTELET <cmotelet@motelet.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const commands = {
  "auto":    '{"action":"setState","value":"auto"}',
  "wind":    '{"action":"setState","value":"wind"}',
  "route":   '{"action":"setState","value":"route"}',
  "standby": '{"action":"setState","value":"standby"}',
  "+1":      '{"action":"changeHeadingByKey","value":"+1"}',
  "+10":     '{"action":"changeHeadingByKey","value":"+10"}',
  "-1":      '{"action":"changeHeadingByKey","value":"-1"}',
  "-10":     '{"action":"changeHeadingByKey","value":"-10"}',
  "tackToPort":   '{"action":"tackTo","value":"port"}',
  "tackToStarboard":   '{"action":"tackTo","value":"starboard"}',
  "advanceWaypoint":   '{"action":"advanceWaypoint"}'
}

var notificationsArray = {};

var touchEnd = function(event) {
  event.currentTarget.onclick();
  event.preventDefault(true);
}

var ws = null;
var handlePilotStatusTimeout = null;
var handleHeadindValueTimeout = null;
var handleReceiveTimeout = null;
var handleSilenceScreenTimeout = null;
var handleConfirmActionTimeout = null;
var handleCountDownCounterTimeout = null;
var connected = false;
var reconnect = true;
const timeoutReconnect = 2000;
const timeoutValue = 2000;
const timeoutBlink = 500;
const countDownDefault = 5;
const noDataMessage = '-- -- -- --';
var pilotStatusDiv = undefined;
var headingValueDiv = undefined;
var receiveIconDiv = undefined;
var sendIconDiv = undefined;
var errorIconDiv = undefined;
var countDownCounterDiv = undefined;
var powerOnIconDiv = undefined;
var powerOffIconDiv = undefined;
var bottomBarIconDiv = undefined;
var notificationCounterDiv = undefined;
var notificationCounterTextDiv = undefined;
var silenceScreenDiv = undefined;
var silenceScreenText = undefined;
var confirmScreenDiv = undefined;
var skPathToAck = '';
var actionToBeConfirmed = '';
var countDownValue = 0;
var pilotStatus = '';

var startUpRayRemote = function() {
  pilotStatusDiv = document.getElementById('pilotStatus');
  headingValueDiv = document.getElementById('headingValue');
  receiveIconDiv = document.getElementById('receiveIcon');
  sendIconDiv = document.getElementById('sendIcon');
  errorIconDiv = document.getElementById('errorIcon');
  powerOnIconDiv = document.getElementById('powerOnIcon');
  powerOffIconDiv = document.getElementById('powerOffIcon');
  bottomBarIconDiv = document.getElementById('bottomBarIcon');
  notificationCounterDiv = document.getElementById('notificationCounter');
  notificationCounterTextDiv = document.getElementById('notificationCounterText');
  silenceScreenDiv = document.getElementById('silenceScreen');
  silenceScreenTextDiv = document.getElementById('silenceScreenText');
  confirmScreenDiv = document.getElementById('confirmScreen');
  countDownCounterDiv = document.getElementById('countDownCounter');
  setPilotStatus(noDataMessage);
  setHeadindValue(noDataMessage);
//  demo(); return;
  setTimeout(() => {
    receiveIconDiv.style.visibility = 'hidden';
    sendIconDiv.style.visibility = 'hidden';
    errorIconDiv.style.visibility = 'hidden';
    bottomBarIconDiv.style.visibility = 'hidden';
    notificationCounterDiv.style.visibility = 'hidden';
    countDownCounterDiv.innerHTML = '';
    wsConnect();
  }, 1500);
}

var demo = function () {
  setHeadindValue(100);
  setPilotStatus('WIND');
  setNotificationMessage({"path":"notifications.autopilot.PilotWarningWindShift","value":{"state":"alarm","message":"Pilot Warning Wind Shift"}});
  powerOffIconDiv.style.visibility = 'hidden';
  powerOnIconDiv.style.visibility = 'visible';
  countDownCounterDiv.innerHTML = countDownDefault.toString();
}

var buildAndSendCommand = function(cmd) {
  var cmdJson = commands[cmd];
  if (typeof cmdJson === 'undefined') {
    alert('Unknown command !');
    return null;
  }
  if ((actionToBeConfirmed !== '')&&(actionToBeConfirmed !== cmd)) {
    clearConfirmCmd();
  }
  if (((cmd === 'tackToPort')||(cmd === 'tackToStarboard'))&&(actionToBeConfirmed === '')) {
    confirmTack(cmd);
    return null;
  }
  if ((cmd === 'route')&&(pilotStatus === 'route')&&(actionToBeConfirmed === '')) {
    confirmAdvanceWaypoint(cmd);
    return null;
  }
  if (actionToBeConfirmed === cmd) {
    clearConfirmCmd();
    if ((cmd === 'tackToPort')||(cmd === 'tackToStarboard')) {
      sendCommand(commands['auto']); // force mode 'auto' to take a tack
      sendCommand(cmdJson);
    }
    if ((cmd === 'route')&&(pilotStatus === 'route')) {
      sendCommand(commands['advanceWaypoint']);
    }
    return null;
  }
  sendCommand(cmdJson);
}

var sendCommand = function(cmdJson) {
  errorIconDiv.style.visibility = 'hidden';
  sendIconDiv.style.visibility = 'visible';
  window.fetch('/plugins/raymarineautopilot/command', {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
    },
    body: cmdJson,
  }).then(function(response) {
      setTimeout(() => {sendIconDiv.style.visibility = 'hidden';}, timeoutBlink);
      if (response.status !== 200) {
        errorIconDiv.style.visibility = 'visible';
        if (response.status === 401) {
          alert('You must be authenticated to send commands !')
        } else {
          errorIconDiv.style.visibility = 'visible';
          alert('[' + response.status + ']' + response.text)
        }
      }
    }, function(status) {
        sendIconDiv.style.visibility = 'hidden';
        errorIconDiv.style.visibility = 'visible';
        alert(status.message)
    }
  );
  reconnect = true;
  wsConnect();
}

var notificationToValue = function (skPathToAck) {
  var message = notificationsArray[skPathToAck];
  if (typeof message === 'undefined') {
    message = 'No current alarm...';
  }
  return message;
}

var sendSilence = function() {
  if (silenceScreenDiv.style.visibility !== 'visible') {
    silenceScreenDiv.style.visibility = 'visible';
    autoHideSilenceScreen();
    if ((Object.keys(notificationsArray).length > 0) && (skPathToAck === '')) {
      skPathToAck = Object.keys(notificationsArray)[0];
    }
  } else {
      if (skPathToAck !== '') {
        sendCommand('{"action":"silenceAlarm","value":{"signalkPath":"' + skPathToAck + '"}}');
      }
      countDownValue = 0;
      updateCountDownCounter();
      silenceScreenDiv.style.visibility = 'hidden';
    }
  silenceScreenTextDiv.innerHTML = notificationToValue(skPathToAck);
}

var notificationScroll = function() {
  autoHideSilenceScreen();
  if (silenceScreenDiv.style.visibility !== 'visible') {
    silenceScreenDiv.style.visibility = 'visible';
    if ((Object.keys(notificationsArray).length > 0) && (skPathToAck === '')) {
      skPathToAck = Object.keys(notificationsArray)[0];
    }
  } else {
      skPathToAck = getNextNotification(skPathToAck);
    }
  silenceScreenTextDiv.innerHTML = notificationToValue(skPathToAck);
}

var autoHideSilenceScreen = function() {
  countDownValue = countDownDefault;
  updateCountDownCounter();
  clearTimeout(handleSilenceScreenTimeout);
  handleSilenceScreenTimeout = setTimeout(() => {
    silenceScreenDiv.style.visibility = 'hidden';
    countDownValue = 0;
    updateCountDownCounter();
  }, 5000);
}

var getNextNotification = function(skPath) {
  var notificationsKeys = Object.keys(notificationsArray);
  var newSkPathToAck = '';
  var index;
  if (notificationsKeys.length > 0) {
    if (typeof skPath !== 'undefined') {
      index = notificationsKeys.indexOf(skPath) + 1;
    } else {
        index = 0;
      }
    if (notificationsKeys.length <= index) {
      index = 0;
    }
    newSkPathToAck = notificationsKeys[index];
  }
  return newSkPathToAck;
}

var confirmTack = function(cmd) {
  var message = 'Repeat same key<br>to confirm<br>tack to ';
  if (cmd === 'tackToPort') {
    message += 'port';
    actionToBeConfirmed = cmd;
  } else if (cmd === 'tackToStarboard') {
      message += 'starboard';
      actionToBeConfirmed = cmd;
    } else {
        actionToBeConfirmed = '';
        return null;
      }
  startConfirmCmd(cmd, message);
}

var confirmAdvanceWaypoint = function(cmd) {
  var message = 'Repeat key TRACK<br>to confirm<br>Advance Waypoint';
  startConfirmCmd(cmd, message);
}

var startConfirmCmd = function (cmd, message) {
  countDownValue = countDownDefault;
  actionToBeConfirmed = cmd;
  updateCountDownCounter();
  confirmScreenDiv.innerHTML = '<p>' + message + '</p>';
  confirmScreenDiv.style.visibility = 'visible';
  clearTimeout(handleConfirmActionTimeout);
  handleConfirmActionTimeout = setTimeout(() => {
    confirmScreenDiv.style.visibility = 'hidden';
    confirmScreenDiv.innerHTML = '';
    actionToBeConfirmed = '';
  }, 5000);
}

var clearConfirmCmd = function () {
  clearTimeout(handleConfirmActionTimeout);
  clearTimeout(handleCountDownCounterTimeout);
  countDownValue = -1;
  countDownCounterDiv.innerHTML = '';
  confirmScreenDiv.style.visibility = 'hidden';
  confirmScreenDiv.innerHTML = '';
  actionToBeConfirmed = '';
  cmdConfirmed = false;
}

var wsConnect = function() {
  if (ws === null) {
    try {
      reconnect = true;
      ws = new WebSocket((window.location.protocol === 'https:' ? 'wss' : 'ws') + "://" + window.location.host + "/signalk/v1/stream?subscribe=none");

      ws.onopen = function() {
        connected = true;
        powerOffIconDiv.style.visibility = 'hidden';
        powerOnIconDiv.style.visibility = 'visible';
        errorIconDiv.style.visibility = 'hidden';
        var subscriptionObject = {
          "context": "vessels.self",
          "subscribe": [
            {
              "path": "steering.autopilot.state",
              "format": "delta",
              "minPeriod": 900
            },
            {
              "path": "navigation.headingMagnetic",
              "format": "delta",
              "minPeriod": 900
            },
            {
              "path": "notifications.autopilot.*",
              "format": "delta",
              "minPeriod": 200
            }
          ]
        };
        var subscriptionMessage = JSON.stringify(subscriptionObject);
        ws.send(subscriptionMessage);
        handlePilotStatusTimeout = setTimeout(() => {setPilotStatus(noDataMessage)}, timeoutValue);
        handleHeadindValueTimeout = setTimeout(() => {setHeadindValue(noDataMessage)}, timeoutValue);
      }

      ws.onclose = function() {
        cleanOnClosed();
        if (reconnect === true) {
          setTimeout(() => {wsConnect()}, timeoutReconnect);
        }
      }

      ws.onerror = function() {
        console.log("ws error");
        cleanOnClosed();
        errorIconDiv.style.visibility = 'visible';
        if (reconnect === true) {
          setTimeout(() => {wsConnect()}, timeoutReconnect);
        }
      }

      ws.onmessage = function(event) {
        receiveIconDiv.style.visibility = 'visible';
        clearTimeout(handleReceiveTimeout);
        handleReceiveTimeout = setTimeout(() => {receiveIconDiv.style.visibility = 'hidden';}, timeoutBlink);
        var jsonData = JSON.parse(event.data)
        dispatchMessages(jsonData);
      }

    } catch (exception) {
      console.error(exception);
      cleanOnClosed();
      errorIconDiv.style.visibility = 'visible';
      setTimeout(() => {wsConnect()}, timeoutReconnect);
    }
  }
}

var dispatchMessages = function(jsonData) {
  if (typeof jsonData.updates === 'object') {
    jsonData.updates.forEach((update) => {
      if (typeof update.values === 'object') {
        update.values.forEach((value) => {
          if (value.path === "steering.autopilot.state") {
            clearTimeout(handlePilotStatusTimeout);
            handlePilotStatusTimeout = setTimeout(() => {setPilotStatus(noDataMessage)}, timeoutValue);
            setPilotStatus(value.value);
          } else if (value.path === "navigation.headingMagnetic") {
            clearTimeout(handleHeadindValueTimeout);
            handleHeadindValueTimeout = setTimeout(() => {setHeadindValue(noDataMessage)}, timeoutValue);
            setHeadindValue(Math.round(value.value * (180/Math.PI)));
          } else if (value.path.startsWith("notifications.autopilot")) {
            setNotificationMessage(value);
          }
        });
      }
    });
  }
}

var setHeadindValue = function(value) {
  if (value !== '') {
    value = ((typeof value === 'undefined') || isNaN(value)) ? noDataMessage : 'Mag:' + value + '&deg;';
  }
  headingValueDiv.innerHTML = value;
}

var setPilotStatus = function(value) {
  if (typeof value === 'undefined') {
    value = noDataMessage;
  }
  pilotStatusDiv.innerHTML = value;
  pilotStatus = value;
}

var setNotificationMessage = function(value) {
  if (typeof value.path !== 'undefined') {
    value.path = value.path.replace('notifications.', '');
    if (typeof value.value !== 'undefined') {
      if (value.value.state === 'normal') {
        if (bottomBarIconDiv.innerHTML === notificationsArray[value.path]) {
          bottomBarIconDiv.innerHTML = '';
        }
        delete notificationsArray[value.path]
      } else {
          notificationsArray[value.path] = value.value.message.replace('Pilot', '');
          bottomBarIconDiv.style.visibility = 'visible';
          bottomBarIconDiv.innerHTML = notificationsArray[value.path];
        }
    }
  }
  var alarmsCount = Object.keys(notificationsArray).length;
  if (alarmsCount > 0) {
    notificationCounterTextDiv.innerHTML = alarmsCount;
    notificationCounterDiv.style.visibility = 'visible';
    if (bottomBarIconDiv.innerHTML === '') {
      bottomBarIconDiv.innerHTML = Object.keys(notificationsArray)[0];
    }
  } else {
      notificationCounterTextDiv.innerHTML = '';
      notificationCounterDiv.style.visibility = 'hidden';
      bottomBarIconDiv.style.visibility = 'hidden';
      bottomBarIconDiv.innerHTML = '';
    }
}

var displayHelp = function() {
  bottomBarIconDiv.style.visibility = 'visible';
  bottomBarIconDiv.innerHTML = '&nbsp;Not yet implemented...'
  setTimeout(() => {bottomBarIconDiv.style.visibility = 'hidden';}, 2000);
}

var wsOpenClose = function() {
  if (connected === false) {
    wsConnect();
  } else {
      reconnect = false;
      if (ws !== null) {
        ws.close();
      }
      cleanOnClosed();
    }
}

var cleanOnClosed = function() {
  ws = null;
  connected = false;
  receiveIconDiv.style.visibility = 'hidden';
  sendIconDiv.style.visibility = 'hidden';
  errorIconDiv.style.visibility = 'hidden';
  bottomBarIconDiv.style.visibility = 'hidden';
  notificationCounterDiv.style.visibility = 'hidden';
  powerOffIconDiv.style.visibility = 'visible';
  powerOnIconDiv.style.visibility = 'hidden';
  notificationCounterDiv.style.visibility = 'hidden';
  silenceScreenDiv.style.visibility = 'hidden';
  notificationCounterTextDiv.innerHTML = '';
  notificationsArray = {};
  skPathToAck = '';
  actionToBeConfirmed = '';
  pilotStatus = '';
  clearTimeout(handleHeadindValueTimeout);
  clearTimeout(handlePilotStatusTimeout);
  setPilotStatus('');
  setHeadindValue('');
}

var updateCountDownCounter = function() {
  if (countDownValue > 0) {
    clearTimeout(handleCountDownCounterTimeout);
    countDownCounterDiv.innerHTML = countDownValue;
    countDownValue -= 1;
    handleCountDownCounterTimeout = setTimeout(() => {
      updateCountDownCounter();
    }, 1000);
  } else {
      clearTimeout(handleCountDownCounterTimeout);
      countDownCounterDiv.innerHTML = '';
    }
}
