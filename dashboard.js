// UI Controller

var controller = function () {

    const LightRed = '#FFA0A0';

    var nmeaGNInterval = 10000;
    var nmeaINInterval = 1000;
    var nmeaPort = 8081;
    
    // ToDo: clear stats if user/boat changes
    var currentUserId, currentTeam;
    var requests = new Map();

    // Polars and other game parameters, indexed by polar._id
    var polars = [];

    var races = new Map();
    var racefriends = new Map();
    var sortField = "none";
    var currentSortField = "none";
    var currentSortOrder = 0;
    var sailNames = [0, "Jib", "Spi", "Stay", "LJ", "C0", "HG", "LG", 8, 9,
                     // VR sends sailNo + 10 to indicate autoSail. We use sailNo mod 10 to find the sail name sans Auto indication.
                     "Auto", "Jib (Auto)", "Spi (Auto)", "Stay (Auto)", "LJ (Auto)", "C0 (Auto)", "HG (Auto)", "LG (Auto)"];

    function addSelOption(race, beta, disabled) {
        var option = document.createElement("option");
        option.text = race.name + (beta ? " beta" : "") + " (" + race.id.substr(0, 3) + ")";
        option.value = race.id;
        option.betaflag = beta;
        option.disabled = disabled;
        selRace.appendChild(option);
    }

    function initRace(race, disabled) {
        race.tableLines = [];
        races.set(race.id, race);
        var rfdef = new Map();
        rfdef.table = new Array();
        rfdef.uinfo = new Object();
        racefriends.set(race.id, rfdef);
        addSelOption(race, false, disabled);
        if (race.has_beta) {
            addSelOption(race, true, disabled);
        }
    }

    function initRaces() {
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var json = xhr.responseText;
            json = JSON.parse(json);
            for (var i = 0; i < json.races.length; i++) {
                console.log("Race: " + JSON.stringify(json.races[i]));
                json.races[i].source = "zezo";
                initRace(json.races[i], true);
            }
            divRaceStatus = document.getElementById("raceStatus");
            divRaceStatus.innerHTML = makeRaceStatusHTML();
            divFriendList = document.getElementById("friendList");
            divFriendList.innerHTML = "No boats positions received yet";
       }
        xhr.open("GET", "http://zezo.org/races2.json");
        //xhr.open("GET", "races2.json");
        xhr.send();
    }

    // Earth radius in nm, 360*60/(2*Pi);
    var radius = 3437.74683;

    var selRace, cbRouter, cbReuseTab, cbLocalTime;
    var lbBoatname, lbTeamname;
    var divPositionInfo, divRecordLog, divRawLog;
    var callRouterFunction;
    var initialized = false;

    var tableHeader = '<tr>'
        + '<th>' + "Time" + '</th>'
        + commonHeaders()
        + '<th title="Reported speed">' + "vR (kn)" + '</th>'
        + '<th title="Calculated speed (Δd/Δt)">' + "vC (kn)" + '</th>'
        + '<th title="Polar-derived speed">' + "vT (kn)" + '</th>'
        + '<th title="Foiling factor">' + "Foils" + '</th>'
        + '<th title="Calculated distance">' + "Δd (nm)" + '</th>'
        + '<th title="Time between positions">' + "Δt (s)" + '</th>'
        + '<th title="Sail change time remaining">' + "Sail" + '</th>'
        + '<th title="Gybing time remaining">' + "Gybe" + '</th>'
        + '<th title="Tacking time remaining">' + "Tack" + '</th>'
        + '</tr>';

    var raceStatusHeader = '<tr>'
        + '<th title="Call Router">' + "RT" + '</th>'
        + '<th title="Call Polars">' + "PL" + '</th>'
        + '<th title="Call WindInfo">' + "WI" + '</th>'
        + '<th>' + "Race" + '</th>'
        + commonHeaders()
        + '<th title="Boat speed">' + "Speed" + '</th>'
        + '<th>' + "Options" + '</th>'
        + '<th>' + "Cards" + '</th>'
        + '<th title="Time to next barrel">' + "Pack" + '</th>'
        + '<th title="Boat is aground">' + "Agnd" + '</th>'
        + '<th title="Boat is maneuvering, half speed">' + "Mnvr" + '</th>'
        + '<th>' + "Last Command" + '</th>'
        + '</tr>';

    function friendListHeader() {
        return '<tr>'
            + genth("th_rt", "RT", "Call Router", sortField == "none", undefined)
            + genth("th_name", "Skipper", undefined, sortField == "displayName", currentSortOrder)
            + recordRaceColumns()
            + genth("th_lu", "Last Update", undefined, sortField == "ts", currentSortOrder)
            + genth("th_rank", "Rank", undefined, sortField == "rank", currentSortOrder)
            + genth("th_dtf", "DTF", "Distance to Finish", sortField == "dtf", currentSortOrder)
            + genth("th_dtu", "DTU", "Distance to Us", sortField == "distanceToUs", currentSortOrder)
            + genth("th_brg", "BRG", "Bearing from Us", undefined)
            + genth("th_sail", "Sail", undefined, sortField == "sail", currentSortOrder)
            + genth("th_state", "State", undefined, sortField == "state", currentSortOrder)
            + genth("th_psn", "Position", undefined)
            + genth("th_hdg", "HDG", "Heading", sortField == "heading", currentSortOrder)
            + genth("th_twa", "TWA", "True Wind Angle", sortField == "twa", currentSortOrder)
            + genth("th_tws", "TWS", "True Wind Speed", sortField == "tws", currentSortOrder)
            + genth("th_speed", "Speed", "Boat Speed", sortField == "speed", currentSortOrder)
            + genth("th_factor", "Factor", "Speed factor over no-options boat", undefined)
            + genth("th_foils", "Foils", "Boat assumed to have Foils. Unknown if no foiling conditions", undefined)
            + genth("th_hull", "Hull", "Boat assumed to have Hull polish", undefined)
            + '</tr>';
    }

    function recordRaceColumns () {
        var race = races.get(selRace.value);
        if (race.type === "record") {
            return genth("th_sd","Start Date",undefined, sortField == "startDate", currentSortOrder)
                + genth("th_ert","ERT", "Estimated Total Race Time", sortField == "eRT", currentSortOrder)
                + genth("th_avgspeed","avgS", "Average Speed", sortField == "avgSpeed", currentSortOrder);
        } else {
            return "";
        }
    }

    function genth(id, content, title, sortfield, sortmark) {
        if (sortfield && sortmark != undefined) {
            content = content + " " + (sortmark ? "&#x25b2;" : "&#x25bc;");
        }
        return '<th id="' + id + '"'
            + (sortfield ? ' style="background: DarkBlue;"' : "")
            + (title ? (' title="' + title + '"') : "")
            + '>' + content + '</th>';
    }

    function commonHeaders() {
        return '<th>' + "Rank" + '</th>'
            + '<th title="Distance To Leader">' + "DTL" + '</th>'
            + '<th title="Distance To Finish">' + "DTF" + '</th>'
            + '<th>' + "Position" + '</th>'
            + '<th title="Heading">' + "HDG" + '</th>'
            + '<th title="True Wind Angle">' + "TWA" + '</th>'
            + '<th title="True Wind Speed">' + "TWS" + '</th>'
            + '<th title="True Wind Direction">' + "TWD" + '</th>'
            + '<th title="Auto Sail time remaining">' + "aSail" + '</th>';
    }

    function printLastCommand(lcActions) {
        var lastCommand = "";

        lcActions.map(function (action) {
            if (action.type == "heading") {
                lastCommand += (action.autoTwa ? " TWA" : " HDG") + "=" + roundTo(action.value, 1);
            } else if (action.type == "sail") {
                lastCommand += " Sail=" + sailNames[action.value];
            } else if (action.type == "prog") {
                action.values.map(function (progCmd) {
                    var progTime = formatDate(progCmd.ts);
                    lastCommand += (progCmd.autoTwa ? " TWA" : " HDG") + "=" + roundTo(progCmd.heading, 1) + " @ " + progTime + "; ";
                });
            } else if (action.type == "wp") {
                action.values.map(function (waypoint) {
                    lastCommand += " WP: " + formatPosition(waypoint.lat, waypoint.lon) + "; ";
                });
            }
        });
        return lastCommand;
    }

    function commonTableLines(r) {
        var sailInfo = sailNames[r.curr.sail % 10];
        var isAutoSail = ((r.curr.tsEndOfAutoSail - r.curr.lastCalcDate) > 0);
        if (isAutoSail) {
            sailInfo = sailInfo + " (A " + formatHMS(r.curr.tsEndOfAutoSail - r.curr.lastCalcDate) + ")";
        } else {
            sailInfo = sailInfo + " (Man)";
        }

        var sailNameBG = r.curr.badSail ? LightRed : "lightgreen";

        var twaFG = (r.curr.twa < 0) ? "red" : "green";
        var twaBold = r.curr.twaAuto ? "font-weight: bold;" : "";
        var hdgFG = r.curr.twaAuto ? "black" : "blue";
        var hdgBold = r.curr.twaAuto ? "font-weight: normal;" : "font-weight: bold;";

        return '<td>' + (r.rank ? r.rank : "-") + '</td>'
            + '<td>' + (r.dtl ? roundTo(r.dtl, 2) : "-") + '</td>'
            + '<td>' + roundTo(r.curr.distanceToEnd, 1) + '</td>'
            + '<td>' + formatPosition(r.curr.pos.lat, r.curr.pos.lon) + '</td>'
            + '<td style="color:' + hdgFG + ";" + hdgBold + '">' + roundTo(r.curr.heading, 1) + '</td>'
            + '<td style="color:' + twaFG + ";" + twaBold + '">' + roundTo(Math.abs(r.curr.twa), 1) + '</td>'
            + '<td>' + roundTo(r.curr.tws, 2) + '</td>'
            + '<td>' + roundTo(r.curr.twd, 1) + '</td>'
            + '<td style="background-color:' + sailNameBG + ';">' + sailInfo + '</td>';
    }

    function makeRaceStatusLine(pair) {
        var r = pair[1];
        if (r.curr == undefined) {
            return "";
        } else {
            var agroundBG = r.curr.aground ? LightRed : "lightgreen";
            var manoeuvering = (r.curr.tsEndOfSailChange > r.curr.lastCalcDate)
                || (r.curr.tsEndOfGybe > r.curr.lastCalcDate)
                || (r.curr.tsEndOfTack > r.curr.lastCalcDate);
            var lastCommand = "-";
            var lastCommandBG = "";
            if (r.lastCommand != undefined) {
                // ToDo: error handling; multiple commands; expiring?
                var lcTime = formatTime(r.lastCommand.request.ts);
                lastCommand = printLastCommand(r.lastCommand.request.actions);
                lastCommand = "T:" + lcTime + " Actions:" + lastCommand;
                if (r.lastCommand.rc != "ok") {
                    lastCommandBG = LightRed;
                }
            }

            var cards = "";
            var regPack = "";
            var regColor = "";

            if (r.curr.fullOptions !== undefined) {
                cards = "Full";
                regPack = "N/A";
            } else {
                for (var key in r.curr.cards) {
                    cards = cards + " " + key + ":" + r.curr.cards[key];
                }
                if (r.curr.regPack) {
                    if (r.curr.regPack.tsNext > r.curr.lastCalcDate) {
                        regPack = formatHMS(r.curr.regPack.tsNext - r.curr.lastCalcDate);
                    } else {
                        regPack = "Ready";
                        regColor = ' style="background-color: lightgreen;"';
                    }
                }
                if (r.curr.soloCard) {
                    regPack += '<br>Solo: ';
                    if (r.curr.soloCard.ts > r.curr.lastCalcDate) {
                        regPack += r.curr.soloCard.code + ":" + formatMS(r.curr.soloCard.ts - r.curr.lastCalcDate);
                    } else {
                        regPack += "?";
                    }
                }
            }

            var info = "-";
            if (r.type === "leg") {
                info = '<span>' + r.legName + '</span>';
            } else if (r.type === "record") {
                if (r.record) {
                    info = '<span>Record, Attempt ' + parseInt(r.record.attemptCounter) + '</span>';
                } else {
                    info = '<span>-</span>'
                }
            }
            if (r.record && r.record.lastRankingGateName) {
                info += '<br/><span>@ ' + r.record.lastRankingGateName + '</span>';
            }

            var trstyle = "hov";
            if (r.id === selRace.value) trstyle += " sel";
            return '<tr class="' + trstyle + '" id="rs:' + r.id + '">'
                + (r.url ? ('<td class="tdc"><span id="rt:' + r.id + '">&#x2388;</span></td>') : '<td>&nbsp;</td>')
                + '<td class="tdc"><span id="pl:' + r.id + '">&#x26F5;</span></td>'
                + '<td class="tdc"><span id="wi:' + r.id + '"><img class="icon" src="wind.svg"/></span></td>'
                + '<td>' + r.name + '</td>'
                + commonTableLines(r)
                + '<td>' + roundTo(r.curr.speed, 2) + '</td>'
                + '<td>' + ((r.curr.options.length == 8) ? ((cards == "Full") ? "Full" : "All") : r.curr.options.join(" ")) + '</td>'
                + '<td>' + cards + '</td>'
                + '<td' + regColor + '>' + regPack + '</td>'
                + '<td style="background-color:' + agroundBG + ';">' + (r.curr.aground ? "AGROUND" : "No") + '</td>'
                + '<td>' + (manoeuvering ? "Yes" : "No") + '</td>'
                + '<td style="background-color:' + lastCommandBG + ';">' + lastCommand + '</td>'
                + '</tr>';
        }
    }

    function boatinfo(uid, uinfo) {
        var res = {
            name: uinfo.displayName,
            nameStyle: "",
            speed: uinfo.speed,
            heading: uinfo.heading,
            tws: uinfo.tws,
            twa: Math.abs(uinfo.twa),
            bcolor: '#2266AA'
        };

        if (uid == currentUserId) {
            res.nameStyle = "color: #F70000; font-weight: bold; ";
            res.bcolor = '#F70000';
            if (!uinfo.displayName) {
                res.name = 'Me';
            }
        } else if (uinfo.mode == "followed") {
            res.nameStyle = "font-weight: bold; ";
            res.bcolor = '#AA66BB';
        } else if (uinfo.type == "top") {
            res.nameStyle += "color: DarkGoldenRod;";
            res.bcolor = 'DarkGoldenRod'
        } else if (uinfo.type == "real") {
            res.nameStyle += "color: DarkGreen;";
            res.bcolor = 'DarkGreen';
        } else if (uinfo.type == "sponsor") {
            res.nameStyle += "color: BlueViolet;";
            res.name += "(" + uinfo.bname + ")";
            res.bcolor = 'BlueViolet';
        }

        res.team = "none";
        if (uinfo.team && uinfo.teamname) {
            res.team = uinfo.teamname;
            res.bcolor = 'red';
        }

        res.twaStyle = 'style="color: ' + ((uinfo.twa < 0) ? "red" : "green") + ';"';
        res.sail = sailNames[uinfo.sail] || "-";

        res.xfactorStyle = 'style="color:' + ((uinfo.xplained) ? "black" : "red") + ';"';
        return (res);
    }

    function makeFriendListLine(uid) {
        if (uid == undefined) {
            return "";
        } else {
            var r = this.uinfo[uid];
            var race = races.get(selRace.value);
            if (r == undefined || race.legdata == undefined) return "";

            var bi = boatinfo(uid, r);

            r.dtf = r.distanceToEnd;
            r.dtfC = gcDistance(r.pos, race.legdata.end);
            if (!r.dtf || r.dtf == "null") {
                r.dtf = r.dtfC;
            }

            var sortDisplay = 0;
            sortDisplay = (uid == currentUserId) // always display own boat
                || (r.mode == "followed" && cbFriends.checked)
                || (r.mode == "opponents" && cbOpponents.checked)
                || (bi.team != "none" && cbTeam.checked)
                || (r.type == "top" && cbTop.checked)
                || (r.type == "real" && cbReals.checked)
                || (r.type == "sponsor" && cbOpponents.checked);
            var inrace = ((r.state != "racing" && cbInRace.checked) ? 0 : 1);

            if (sortDisplay == 1) {
                if (inrace == 1) {
                    return '<tr class="hov" id="ui:' + uid + '">'
                        + (race.url ? ('<td class="tdc"><span id="rt:' + uid + '">&#x2388;</span></td>') : '<td>&nbsp;</td>')
                        + '<td style="' + bi.nameStyle + '">' + bi.name + '</td>'
                        + recordRaceFields(race, r)
                        + '<td>' + formatDateShort(r.lastCalcDate) + '</td>'
                        + '<td>' + (r.rank ? r.rank : "-") + '</td>'
                        + "<td>" + ((r.dtf==r.dtfC)?"(" + roundTo(r.dtfC, 1) + ")":r.dtf) + "</td>"
                        + '<td>' + (r.distanceToUs ? r.distanceToUs : "-") + '</td>'
                        + '<td>' + (r.bearingFromUs ? r.bearingFromUs + "&#x00B0;" : "-") + '</td>'
                        + '<td>' + bi.sail + '</td>'
                        + '<td>' + (r.state || "-") + '</td>'
                        + '<td>' + (r.pos ? formatPosition(r.pos.lat, r.pos.lon) : "-") + '</td>'
                        + '<td>' + roundTo(bi.heading, 1) + '</td>'
                        + '<td ' + bi.twaStyle + '>' + roundTo(bi.twa, 1) + '</td>'
                        + '<td>' + roundTo(bi.tws, 1) + '</td>'
                        + '<td>' + roundTo(bi.speed, 2) + '</td>'
                        + '<td ' + bi.xfactorStyle + '>' + roundTo(r.xfactor, 4) + '</td>'
                        + '<td>' + (r.xoption_foils || "?") + '</td>'
                        + '<td>' + (r.xoption_hull || "?") + '</td>'
                        + '</tr>';
                }
            }
        }
    }

    function recordRaceFields (race, r) {
        if (race.type === "record") {
            if (r.state === "racing" && r.distanceToEnd) {
                try {
                    var raceTime = (r.ts - r.startDate);
                    var estimatedSpeed = r.distanceFromStart / (raceTime / 3600000);
                    var eTtF = (r.distanceToEnd / estimatedSpeed) * 3600000;
                    var eRT = raceTime + eTtF;
                    r.avgSpeed = estimatedSpeed;
                    r.eRT = eRT;                    
                } catch (e) {
                    r.eRT = e.toString();
                }
                return '<td>' + formatDate(r.startDate, 'UserCard missing') + '</td>'
                    + '<td>' + formatDHMS(r.eRT) + '</td>'
                    + '<td>' + roundTo(r.avgSpeed, 2) + '</td>';
            } else {
                return '<td>' + 'UserCard missing' + '</td>'
                    + '<td> - </td>'
                    + '<td> - </td>';
            }
        } else {
            return "";
        }
    }

    function raceDistance (course) {
        var dist = 0;
        for (i = 1; i < course.length; i++) {
            dist += gcDistance(course[i-1], course[i]);
        }
        return dist;
    }

    function makeRaceStatusHTML() {
        return '<table>'
            + '<thead>'
            + raceStatusHeader
            + '</thead>'
            + '<tbody>'
            + Array.from(races || []).map(makeRaceStatusLine).join(" ");
            + '</tbody>'
            + '</table>';
    }

    function makeFriendsHTML(rf) {
        var field = "speed";
        if (rf === undefined) {
            return "No friend positions received yet";
        } else {
            sortFriends(rf);
            return '<table>'
                + '<thead class="sticky">'
                + friendListHeader()
                + '</thead>'
                + '<tbody>'
                + Array.from(rf.table || []).map(makeFriendListLine, rf).join(" ");
                + '</tbody>'
                + '</table>';
        }
    }

    function makeTableHTML(r) {
        return '<table>'
            + '<thead class="sticky">'
            + tableHeader
            + '</thead>'
            + '<tbody>'
            + (r === undefined ? "" : r.tableLines.join(" "))
            + '</tbody>'
            + '</table>';
    }

    function updateFriendUinfo(rid, mode, uid, data) {
        var rfd = racefriends.get(rid);
        if (!rfd) {
            console.log("raceInfo not initialized");
            return;
        }
        var race = races.get(rid);
        var ndata = rfd.uinfo[uid];
        var boatPolars = (data.boat) ? polars[data.boat.polar_id] : undefined;

        if (data.pos == undefined) return; // looked up user not in this race
        if (!ndata) {
            ndata = new Object();
            rfd.uinfo[uid] = ndata;
            rfd.table.push(uid); 
        }
        if (mode == "usercard") {
            data.mode = "opponents";
            data.ts = data.lastCalcDate;
            if (data.ts < ndata.ts) data.ts = ndata.ts;
        }
        if (ndata.mode == "followed") data.mode = "followed"; // keep followed state if present
        if (data.team) {
            ndata.teamname = data.teamname;
            ndata.team = data.team;
        }
        var elemlist = ["baseInfos", "displayName", "ts", "lastCalcDate", "startDate", "type", "state", "pos", "heading", "twa", "tws", "speed", "mode", "distanceToEnd", "distanceFromStart", "sail", "bname"];
        // copy elems from data to uinfo
        elemlist.forEach(function (tag) {
            if (tag in data) {
                ndata[tag] = data[tag];
                if (tag == "baseInfos") {
                    ndata.displayName = data["baseInfos"].displayName;
                } else if (tag == "pos") { // calc gc distance to us
                    ndata.distanceToUs = roundTo(gcDistance(race.curr.pos, data.pos), 1);
                    ndata.bearingFromUs = roundTo(courseAngle(race.curr.pos.lat, race.curr.pos.lon, data.pos.lat, data.pos.lon) * 180 / Math.PI, 1);
                    var ad = ndata.bearingFromUs - race.curr.heading + 90;
                    if (ad < 0) ad += 360;
                    if (ad > 360) ad -= 360;
                    if (ad > 180) ndata.distanceToUs = -ndata.distanceToUs; // "behind" us
                }
            }
        });
        
        if (boatPolars) {
//              var sailDef = getSailDef(boatPolars.sail, data.sail % 10);
            var sailDef = boatPolars.sail[data.sail % 10 - 1];

            // "Real" boats have no sail info
            // "Waiting" boats have no TWA
            if (data.state == "racing" && sailDef && data.twa && data.tws) {
                var iA = fractionStep(data.twa, boatPolars.twa);
                var iS = fractionStep(data.tws, boatPolars.tws);

                // "Plain" speed
                var speedT = pSpeed(iA, iS, sailDef.speed);
                // Speedup factors
                var foilFactor = foilingFactor(["foil"], data.tws, data.twa, boatPolars.foil);
                var hullFactor = boatPolars.hull.speedRatio;

                // Explain ndata.speed from plain speed and speedup factors
                explain(ndata, foilFactor, hullFactor, speedT);
            }
        } else {
            ndata.xplained = true;
            ndata.xfactor = 1.0;
            ndata.xoption_foils = "---";
            ndata.xoption_hull = "---";
        }

        if (data["rank"] > 0) ndata["rank"] = data["rank"];
    }

    function explain(ndata, foilFactor, hullFactor, speedT) {
        ndata.xfactor = ndata.speed / speedT;
        ndata.xoption_foils = "?";
        ndata.xoption_hull = "?";
        ndata.xplained = false;

        var foils = ((foilFactor - 1) * 100) / 4 * 100;

        if (epsEqual(ndata.xfactor, 1.0)) {
            // Speed agrees with "plain" speed.
            // Explanation: 1. no hull and 2. foiling condition => no foils.
            ndata.xplained = true;
            ndata.xoption_hull = "no";
            if (foilFactor > 1.0) {
                ndata.xoption_foils = "no";
            }
        } else {
            // Speed does not agree with plain speed.
            // Check if hull, foil or hull+foil can explain the observed speed.
            if (epsEqual(ndata.speed, speedT * hullFactor)) {
                ndata.xplained = true;
                if (epsEqual(hullFactor, foilFactor)) {
                    // Both hull and foil match.
                    ndata.xoption_hull = "(100%)";
                    ndata.xoption_foils = "(" + roundTo(foils, 0) + "%)";
                } else {
                    ndata.xoption_hull = "100%";
                    if (foilFactor > 1.0) {
                        ndata.xoption_foils = "no";
                    }
                }
            } else if (epsEqual(ndata.speed, speedT * foilFactor)) {
                ndata.xplained = true;
                ndata.xoption_hull = "no";
                ndata.xoption_foils = roundTo(foils, 0) + "%";
            } else if (epsEqual(ndata.speed, speedT * foilFactor * hullFactor)) {
                ndata.xplained = true;
                ndata.xoption_hull = "100%";
                ndata.xoption_foils = roundTo(foils, 0) + "%";
            }
        }
    }

    function epsEqual(a, b) {
        return Math.abs(b - a) < 0.00001;
    }

    function sortFriends(rfd) {
        if (sortField != "none") {
            sortFriendsByField(rfd, sortField);
        } else {
            sortFriendsByCategory(rfd);
        }
    }

    function sortFriendsByField(rf, field) {
        rf.table.sort(function (uidA, uidB) {
            // Check if we have values at all
            if (rf.uinfo[uidA] == undefined && rf.uinfo[uidB] == undefined) return 0;
            if (rf.uinfo[uidB] == undefined) return -1;
            if (rf.uinfo[uidA] == undefined) return 1;

            // Fetch value of sort field and convert to number.
            var entryA = rf.uinfo[uidA][field];
            var entryB = rf.uinfo[uidB][field];

            // Prefer defined values over undefined values
            if (entryA == undefined && entryB == undefined) return 0;
            if (entryB == undefined) return -1;
            if (entryA == undefined) return 1;

            // Cast to number if possible
            entryA = numeric(entryA);
            entryB = numeric(entryB);

            // Compare values.
            if (currentSortOrder == 0) {
                if (entryA < entryB) return -1;
                if (entryA > entryB) return 1;
            } else {
                if (entryA > entryB) return -1;
                if (entryA < entryB) return 1;
            }
            return 0;
        });
    }

    function numeric (s) {
        var r = String(s);
        if ( r.substr(0, 1) == "(" ) {
            r = r.slice(1, -1);
        }
        if ( isNaN(r) ) {
            r = r.toUpperCase();
        } else {
            r = Number(r);
        }
        return r;
    }
        
    // generate sorted list, expire old entries
    function sortFriendsByCategory(rfd) {
        var fln = new Array();

        Object.keys(rfd.uinfo).forEach(function (key) {
            fln.push(key);
        });

        fln.sort(function (a, b) {
            var au = rfd.uinfo[a];
            var bu = rfd.uinfo[b];
            // followed before opponents
            if (au.mode != bu.mode) {
                if (au.mode == "followed") return -1;
                if (au.mode == "opponents") return 1;
            }
            if (au.mode == "opponents") {
                var classa = au.type;
                var classb = bu.type;
                // remap types sponsor and top to normal
                if (classa == "sponsor") classa = "normal";
                if (classb == "sponsor") classb = "normal";
                if (classa == "top") classa = "normal";
                if (classb == "top") classb = "normal";

                if (classa != classb) { // different types
                    // order: (normal|sponsor|top) , real, pilotBoat
                    if (classa == "normal") return -1;
                    if (classb == "normal") return 1;
                    if (classa == "real") return -1;
                    if (classb == "real") return 1;
                }
                if (au.rank && bu.rank) {
                    if (au.rank < bu.rank) return -1;
                    if (au.rank > bu.rank) return 1;
                    return 0;
                }
                if (au.rank && !bu.rank) return -1;
                if (bu.rank && !au.rank) return 1;
            }
            // followed or no rank, same type, sort on name
            return (au.displayName && au.displayName.localeCompare(bu.displayName)) || 0;
        });
        rfd.table = fln;
    }

    function updateFriends(rid, mode, data) {
        var rfd = racefriends.get(rid);
        rfd.lastUpdate = Date.now();

        data.forEach(function (delem) {
            delem.mode = mode;
            if (mode === "fleet") {
                if (delem.followed) {
                    delem.mode = "followed";
                } else if (delem.opponent) {
                    delem.mode = "opponents";
                } else {
                    delem.mode = "other";
                }
                if (delem.team) {
                    delem.teamname = currentTeam;
                }
            } else {
                delem.mode = mode;
            }
            if (!delem.ts) delem.ts = Date.now();
            if (delem.type == "sponsor") {
                delem.bname = delem.branding.name;
            }
            if (delem.mode == "opponents") {
                if (delem.type == "pilotBoat") {
                    delem.displayName = "Frigate";
                } else if (delem.type == "real") {
                    delem.displayName = delem.extendedInfos.boatName;
                    delem.rank = delem.extendedInfos.rank;
                }
            }
            updateFriendUinfo(rid, mode, delem.userId, delem);
        });
        sortFriends(rfd);
    }

    function formatSeconds(value) {
        if (value < 0) {
            return "-";
        } else {
            return roundTo(value / 1000, 0);
        }
    }

    function formatDDMMYY (d) {
        var s = ""
            + pad0(d.getUTCDate())
            + pad0(d.getUTCMonth() + 1)
            + d.getUTCFullYear().toString().substring(2,4);
        return s;
        
    }
    function formatHHMMSSSS (d) {
        var s = ""
            + pad0(d.getUTCHours())
            + pad0(d.getUTCMinutes())
            + pad0(d.getUTCSeconds());
        return s;
    }
    
    function formatHMS (seconds) {
        if (seconds === undefined || isNaN(seconds) || seconds < 0) {
            return "-";
        }

        seconds = Math.floor(seconds / 1000);

        var hours = Math.floor(seconds / 3600);
        seconds -= 3600 * hours;

        var minutes = Math.floor(seconds / 60);
        seconds -= minutes * 60;

        return pad0(hours) + "h" + pad0(minutes) + "m"; // + seconds + "s";
    }

    function formatDHMS (seconds) {
        if (seconds === undefined || isNaN(seconds) || seconds < 0) {
            return "-";
        }

        seconds = Math.floor(seconds / 1000);

        var days = Math.floor(seconds / 86400);
        var hours = Math.floor(seconds / 3600) % 24;
        var minutes = Math.floor(seconds / 60) % 60;

        return pad0(days) + "d" + pad0(hours) + "h" + pad0(minutes) + "m"; // + seconds + "s";
    }

    function formatMS(seconds) {
        if (seconds === undefined || isNaN(seconds) || seconds < 0) {
            return "-";
        }

        seconds = Math.floor(seconds / 1000);

        var minutes = Math.floor(seconds / 60);
        seconds -= minutes * 60;

        return pad0(minutes) + "m" + pad0(seconds) + "s";
    }

    function formatDate(ts,
                        dflt,
                        tsOptions = {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "numeric",
                            second: "numeric",
                            hour12: false,
                            timeZoneName: "short"
                        })
    {
        if (!ts && dflt) return dflt;
        // Do not invent a timestamp here.
        if (!ts) {
            return "undefined";
        }
        // Use UTC if local time is not requested
        if (!cbLocalTime.checked) {
            tsOptions.timeZone = "UTC";
        }
        var d = new Date(ts);
        return new Intl.DateTimeFormat("lookup", tsOptions).format(d);
    }

    function formatDateShort(ts, dflt) {
         var tsOptions = {
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            hour12: false,
            timeZoneName: "short"
        }
        return formatDate(ts, dflt, tsOptions);
    }

    function formatTime(ts) {
        var tsOptions = {
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            hour12: false
        };
        var d = (ts) ? (new Date(ts)) : (new Date());
        if (cbLocalTime.checked) {} else {
            tsOptions.timeZone = "UTC";
        }
        return new Intl.DateTimeFormat("lookup", tsOptions).format(d);
    }

    function addTableCommandLine(r) {
        r.tableLines.unshift('<tr>'
                             + '<td>' + formatDate(r.lastCommand.request.ts) + '</td>'
                             + '<td colspan="3">Command @' + formatTime() + '</td>'
                             + '<td colspan="15">Actions:' + printLastCommand(r.lastCommand.request.actions) + '</td>'
                             + '</tr>');
        if (r.id == selRace.value) {
            divRecordLog.innerHTML = makeTableHTML(r);
        }
    }

    function makeTableLine(r) {

        function isDifferingSpeed(speed) {
            return Math.abs(1 - r.curr.speed / speed) > 0.01;
        }

        function isCurrent(timestamp) {
            return (timestamp && (timestamp > r.prev.lastCalcDate));
        }

        function getBG(timestamp) {
            return isCurrent(timestamp) ? ('style="background-color: ' + LightRed + ';"') : "";
        }

        function isPenalty() {
            return isCurrent(r.curr.tsEndOfSailChange)
                || isCurrent(r.curr.tsEndOfGybe)
                || isCurrent(r.curr.tsEndOfTack);
        }

        var speedCStyle = "";
        var speedTStyle = "";
        var deltaDist = roundTo(r.curr.deltaD, 3);
        var speedT = "-";
        if (r.curr.speedT) {
            speedT = roundTo(r.curr.speedT.speed, 2) + "&nbsp;(" + r.curr.speedT.sail + ")";
        }

        if (isPenalty()) {
            speedCStyle = 'style="background-color: ' + LightRed + ';"';
        } else if (isDifferingSpeed(r.curr.speedC)) {
            speedCStyle = 'style="background-color: yellow;"';
        } else if (r.curr.speedT && isDifferingSpeed(r.curr.speedT.speed)) {
            // Speed differs but not due to penalty - assume "Bad Sail" and display theoretical delta
            speedTStyle = 'style="background-color: ' + LightRed + ';"';
            deltaDist = deltaDist + " (" + roundTo(r.curr.deltaD_T, 3) + ")";
        }

        var sailChange = formatSeconds(r.curr.tsEndOfSailChange - r.curr.lastCalcDate);
        var gybing = formatSeconds(r.curr.tsEndOfGybe - r.curr.lastCalcDate);
        var tacking = formatSeconds(r.curr.tsEndOfTack - r.curr.lastCalcDate);

        return '<tr>'
            + '<td>' + formatDate(r.curr.lastCalcDate) + '</td>'
            + commonTableLines(r)
            + '<td>' + roundTo(r.curr.speed, 2) + '</td>'
            + '<td ' + speedCStyle + '>' + roundTo(r.curr.speedC, 2) + " (" + sailNames[(r.curr.sail % 10)] + ")" + '</td>'
            + '<td ' + speedTStyle + '>' + speedT + '</td>'
            + '<td>' + (r.curr.speedT ? (roundTo(r.curr.speedT.foiling, 0) + "%") : "-") + '</td>'
            + '<td ' + speedTStyle + '>' + deltaDist + '</td>'
            + '<td>' + roundTo(r.curr.deltaT, 0) + '</td>'
            + '<td ' + getBG(r.curr.tsEndOfSailChange) + '>' + sailChange + '</td>'
            + '<td ' + getBG(r.curr.tsEndOfGybe) + '>' + gybing + '</td>'
            + '<td ' + getBG(r.curr.tsEndOfTack) + '>' + tacking + '</td>'
            + '</tr>';
    }

    function saveMessage(r) {
        var newRow = makeTableLine(r);
        r.tableLines.unshift(newRow);
        if (r.id == selRace.value) {
            divRecordLog.innerHTML = makeTableHTML(r);
        }
    }

    function changeFriends(race) {
        divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
    }

    function changeRace(raceId) {
        if (typeof raceId === "object") { // select event
            raceId = this.value;
        }
        var race = races.get(raceId);
        divRaceStatus.innerHTML = makeRaceStatusHTML();
        divRecordLog.innerHTML = makeTableHTML(race);
        divFriendList.innerHTML = makeFriendsHTML(racefriends.get(raceId));
        switchMap(race);
    }

    function getRaceLegId(id) {
        // work around for certain messages (Game_GetOpponents)
        if (id.raceId) {
            return id.raceId + "." + id.legNum;
        } else {
            return id.race_id + "." + id.leg_num;
        }
    }

    function legId(legInfo) {
        return legInfo.raceId + "." + legInfo.legNum;
    }

    function clearLog() {
        divRawLog.innerHTML = "";
    }

    function tableClick(ev) {
        var call_rt = false;
        var call_wi = false;
        var call_pl = false;
        var friend = false;
        var tabsel = false;
        var cbox = false;
        var dosort = true;
        var rmatch;
        var re_rtsp = new RegExp("^rt:(.+)"); // Call-Router
        var re_polr = new RegExp("^pl:(.+)"); // Call-Polars
        var re_wisp = new RegExp("^wi:(.+)"); // Weather-Info
        var re_rsel = new RegExp("^rs:(.+)"); // Race-Selection
        var re_usel = new RegExp("^ui:(.+)"); // User-Selection
        var re_tsel = new RegExp("^ts:(.+)"); // Tab-Selection
        var re_cbox = new RegExp("^sel_(.+)"); // Checkbox-Selection

        var ev_lbl = ev.target.id;

        switch (ev_lbl) {
        case "th_name":
            sortField = "displayName";
            break;
        case "th_rank":
            sortField = "rank";
            break;
        case "th_lu":
            sortField = "ts";
            break;
        case "th_sd":
            sortField = "startDate";
            break;
        case "th_ert":
            sortField = "eRT";
            break;
        case "th_avgspeed":
            sortField = "avgSpeed";
            break;
        case "th_dtf":
            sortField = "dtf";
            break;
        case "th_dtu":
            sortField = "distanceToUs";
            break;
        case "th_state":
            sortField = "state";
            break;
        case "th_hdg":
            sortField = "heading";
            break;
        case "th_twa":
            sortField = "twa";
            break;
        case "th_tws":
            sortField = "tws";
            break;
        case "th_speed":
            sortField = "speed";
            break;
        case "th_sail":
            sortField = "sail";
            break;
        case "th_rt":
        case "th_brg":
        case "th_psn":
        case "th_foils":
        case "th_hull":
            sortField = "none";
            break;
        default:
            dosort = false;
        }

        // Sort friends table
        if (dosort) {
            if (sortField == currentSortField) {
                currentSortOrder = 1 - currentSortOrder;
            } else {
                currentSortField = sortField;
                currentSortOrder = 0;
            }
            divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
        }

        for (var node = ev.target; node; node = node.parentNode) {
            var id = node.id;
            var match;
            if (re_rtsp.exec(id)) {
                call_rt = true;
            } else if (re_polr.exec(id)) {
                call_pl = true;
            } else if (re_wisp.exec(id)) {
                call_wi = true;
            } else if (match = re_rsel.exec(id)) {
                rmatch = match[1];
            } else if (match = re_usel.exec(id)) {
                rmatch = match[1];
                friend = true;
            } else if (match = re_tsel.exec(id)) {
                rmatch = match[1];
                tabsel = true;
            } else if (match = re_cbox.exec(id)) {
                rmatch = match[1];
                cbox = true;
            }
        }
        if (rmatch) {
            if (tabsel) {
                // Tab-Selection
                for (var t = 1; t <= 4; t++) {
                    document.getElementById("tab-content" + t).style.display = (rmatch == t ? "block" : "none");
                }
                if (rmatch == 4) {
                    var race = races.get(selRace.value);
                    initializeMap(race);
                }
                if (rmatch == 2) {
                    display_selbox("visible");
                } else {
                    display_selbox("hidden");
                }
            } else if (friend) {
                // Friend-Routing
                if (call_rt) callRouter(selRace.value, rmatch);
            } else if (cbox) {
                // Skippers-Choice
                changeState(ev_lbl);
                divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
            } else {
                // Race-Switching
                if (call_wi) callWindy(rmatch, 0); // weather
                if (call_rt) callRouter(rmatch);
                if (call_pl) callPolars(rmatch);
                enableRace(rmatch, true);
                changeRace(rmatch);
            }
        }
    }

    function changeState(lbl_tochange) {
        cbxlbl = lbl_tochange.replace("lbl_", "sel_");
        selectedcbx = document.getElementById(cbxlbl);
        if (selectedcbx.checked) {
            selectedcbx.checked = false;
        } else {
            selectedcbx.checked = true;
        }
    }

    function display_selbox(state) {
        selFriends.style.visibility = state;
    }

    function resize(ev) {
        for (var t = 1; t <= 4; t++) {
            var tab = document.getElementById("tab-content" + t);
            tab.style.height = window.innerHeight - tab.getBoundingClientRect().y;
        }
    }

    function enableRace(id, force) {
        for (var i = 0; i < selRace.options.length; i++) {
            if (selRace.options[i].value == id) {
                selRace.options[i].disabled = false;
                if (selRace.selectedIndex == -1 || force) {
                    selRace.selectedIndex = i;
                }
            }
        }
    }

    function renameRace(id, newname) {
        for (var i = 0; i < selRace.options.length; i++) {
            if (selRace.options[i].value == id) {
                selRace.options[i].text = newname;
            }
        }
    }

    function disableRaces() {
        for (var i = 0; i < selRace.options.length; i++) {
            selRace.options[i].disabled = true;
        }
        selRace.selectedIndex == -1;
    }

    function addRace(message) {
        var raceId = getRaceLegId(message._id);
        var race = {
            id: raceId,
            name: "Race #" + raceId,
            source: "tmp"
        };
        initRace(race, false);
        return race;
    }

    function updatePosition(message, r) {
        if (r === undefined) { // race not lsited
            r = addRace(message);
        }

        if (r.curr !== undefined && r.curr.lastCalcDate == message.lastCalcDate) {
            // Repeated message
            // return;
        }
        
        if (!r.curr) {
            enableRace(r.id);
        }

        r.prev = r.curr;
        r.curr = message;
        r.curr.speedT = theoreticalSpeed(message);
        if (r.prev != undefined) {
            var d = gcDistance(r.prev.pos, r.curr.pos);
            var delta = courseAngle(r.prev.pos.lat, r.prev.pos.lon, r.curr.pos.lat, r.curr.pos.lon);
            var alpha = Math.PI - angle(toRad(r.prev.heading), delta);
            var beta = Math.PI - angle(toRad(r.curr.heading), delta);
            var gamma = angle(toRad(r.curr.heading), toRad(r.prev.heading));
            // Epoch timestamps are milliseconds since 00:00:00 UTC on 1 January 1970.
            r.curr.deltaT = (r.curr.lastCalcDate - r.prev.lastCalcDate) / 1000;
            if (r.curr.deltaT > 0
                && Math.abs(toDeg(gamma) - 180) > 1
                && toDeg(alpha) > 1
                && toDeg(beta) > 1) {
                r.curr.deltaD = d / Math.sin(gamma) * (Math.sin(beta) + Math.sin(alpha));
            } else {
                r.curr.deltaD = d;
            }
            r.curr.speedC = Math.abs(roundTo(r.curr.deltaD / r.curr.deltaT * 3600, 2));
            // deltaD_T = Delta distance computed from speedT is only displayed when it deviates
            if (r.curr.speedT) {
                r.curr.deltaD_T = r.curr.deltaD / r.curr.speedC * r.curr.speedT.speed;
            }
            saveMessage(r);
        }
        if (message.gateGroupCounters) {
            r.gatecnt = message.gateGroupCounters;
            updateMapCheckpoints(r);
        }
        divRaceStatus.innerHTML = makeRaceStatusHTML();
    }


    function intersectionPoint (p, q, m, r) {
        // Compute the intersection points of a line (p, q) and a circle (m, r)

        // Center on circle
        var s = {}; s.x = p.lat - m.lat; s.y = p.lon - m.lon;
        var t = {}; t.x = q.lat - m.lat; t.y = q.lon - m.lon;

        // Aux variables
        var d = {}; d.x = t.x - s.x; d.y = t.y - s.y;
        
        var dr2 = d.x * d.x + d.y * d.y; 
        var D =  s.x * t.y - t.x * s.y;
        var D2 = D * D;

        // Check if line intersects at all
        var discr = r * r * dr2 - D2;
        if (discr < 0) {
            return null;
        }

        // Compute intersection point of (infinite) line and circle
        var R = Math.sqrt( r * r * dr2 - D2);

        var x1 = (D*d.y + sign(d.y) * d.x * R)/dr2;
        var x2 = (D*d.y - sign(d.y) * d.x * R)/dr2;

        var y1 = (-D*d.x + Math.abs(d.y) * R)/dr2;
        var y2 = (-D*d.x - Math.abs(d.y) * R)/dr2;

        var l1 = (x1 - s.x) / d.x;
        var l2 = (x2 - s.x) / d.x;

        // Check if intersection point is on line segment;
        // choose intersection point closer to p
        if (l1 >= 0 && l1 <= 1 && l1 <= l2) {
            return {"lat": x1 + m.lat, "lng": y1 + m.lon, "lambda": l1};
        } else if (l2 >= 0 && l2 <= 1) {
            return {"lat": x2 + m.lat, "lng": y2 + m.lon, "lambda": l2};
        } else {
            return null;
        }
    }

    function sign (x) {
        return ( x < 0 )? -1: 1;
    }
    


    function angle(h0, h1) {
        return Math.abs(Math.PI - Math.abs(h1 - h0));
    }

    function theoreticalSpeed(message) {
        var boatPolars = polars[message.boat.polar_id];
        if (boatPolars == undefined || message.options == undefined || message.tws == undefined) {
            return undefined;
        } else {
            var tws = message.tws;
            var twd = message.twd;
            var twa = message.twa;
            var options = message.options;
            var foil = foilingFactor(options, tws, twa, boatPolars.foil);
            var foiling = (foil - 1.0) * 100 / (boatPolars.foil.speedRatio - 1.0);
            var hull = options.includes("hull") ? 1.003 : 1.0;
            var ratio = boatPolars.globalSpeedRatio;
            var twsLookup = fractionStep(tws, boatPolars.tws);
            var twaLookup = fractionStep(twa, boatPolars.twa);
            var speed = maxSpeed(options, twsLookup, twaLookup, boatPolars.sail);
            return {
                "speed": roundTo(speed.speed * foil * hull * ratio, 2),
                "sail": sailNames[speed.sail],
                "foiling": foiling
            };
        }
    }

    function maxSpeed(options, iS, iA, sailDefs) {
        var maxSpeed = 0;
        var maxSail = "";
        for (const sailDef of sailDefs) {
            if (sailDef.id === 1
                || sailDef.id === 2
                || (sailDef.id === 3 && options.includes("heavy"))
                || (sailDef.id === 4 && options.includes("light"))
                || (sailDef.id === 5 && options.includes("reach"))
                || (sailDef.id === 6 && options.includes("heavy"))
                || (sailDef.id === 7 && options.includes("light"))) {
                var speed = pSpeed(iA, iS, sailDef.speed);
                if (speed > maxSpeed) {
                    maxSpeed = speed;
                    maxSail = sailDef.id;
                }
            }
        }
        return {
            speed: maxSpeed,
            sail: maxSail
        }
    }

    function getSailDef(sailDefs, id) {
        for (const sailDef of sailDefs) {
            if (sailDef.id === id) {
                return sailDef;
            }
        }
        return null;
    }

    function pSpeed(iA, iS, speeds) {
        return bilinear(iA.fraction, iS.fraction,
                        speeds[iA.index - 1][iS.index - 1],
                        speeds[iA.index][iS.index - 1],
                        speeds[iA.index - 1][iS.index],
                        speeds[iA.index][iS.index]);
    }

    function bilinear(x, y, f00, f10, f01, f11) {
        return f00 * (1 - x) * (1 - y)
            + f10 * x * (1 - y)
            + f01 * (1 - x) * y
            + f11 * x * y;
    }

    function foilingFactor(options, tws, twa, foil) {
        var speedSteps = [0, foil.twsMin - foil.twsMerge, foil.twsMin, foil.twsMax, foil.twsMax + foil.twsMerge, Infinity];
        var twaSteps = [0, foil.twaMin - foil.twaMerge, foil.twaMin, foil.twaMax, foil.twaMax + foil.twaMerge, Infinity];
        var foilMat = [[1, 1, 1, 1, 1, 1],
                       [1, 1, 1, 1, 1, 1],
                       [1, 1, foil.speedRatio, foil.speedRatio, 1, 1],
                       [1, 1, foil.speedRatio, foil.speedRatio, 1, 1],
                       [1, 1, 1, 1, 1, 1],
                       [1, 1, 1, 1, 1, 1]];

        if (options.includes("foil")) {
            var iS = fractionStep(tws, speedSteps);
            var iA = fractionStep(twa, twaSteps);
            return bilinear(iA.fraction, iS.fraction,
                            foilMat[iA.index - 1][iS.index - 1],
                            foilMat[iA.index][iS.index - 1],
                            foilMat[iA.index - 1][iS.index],
                            foilMat[iA.index][iS.index]);
        } else {
            return 1.0;
        }
    }

    function fractionStep(value, steps) {
        var absVal = Math.abs(value);
        var index = 0;
        while (index < steps.length && steps[index] <= absVal) {
            index++;
        }
        if (index < steps.length) {
            return {
                index: index,
                fraction: (absVal - steps[index - 1]) / (steps[index] - steps[index - 1])
            }
        } else {
            return {
                index: index - 1,
                fraction: 1.0
            }
        }
    }

    function callRouterZezo(raceId, userId, beta) {
        var optionBits = {
            "winch": 4,
            "foil": 16,
            "light": 32,
            "reach": 64,
            "heavy": 128
        };

        var baseURL = "http://zezo.org";
        var race = races.get(raceId);
        var uinfo;

        if (userId) {
            // Friend routing request
            uinfo = racefriends.get(raceId).uinfo[userId];
            if (uinfo === undefined) {
                alert("Can't find record for user id " + userId);
                return;
            }
        }

        var options = 0;
        for (var key in race.curr.options) {
            if (optionBits[race.curr.options[key]]) {
                options |= optionBits[race.curr.options[key]];
            }
        }

        if (!race.url) {
            // Panic - check if the race_id part is known.
            // In the unlikely case when the polars change from one leg to another,
            // this will give surprising results...
            var race_id = Number(raceId.split('.')[0]);
            var r = races.get(race_id);
            race.url = r.url;
        }

        if (!race.url) {
            alert("Unknown race - no routing available");
        } else {
            var urlBeta = race.url + (beta ? "b" : "");
            var pos = race.curr.pos;
            var twa = race.curr.twa;
            var uid = race.curr._id.user_id;
            var type = "me";

            if (userId) {
                pos = uinfo.pos;
                twa = uinfo.twa;
                uid = userId;
                type = "friend";
            }

            var url = baseURL + "/" + urlBeta + "/chart.pl?lat=" + pos.lat + "&lon=" + pos.lon +
                "&o=" + options + "&twa=" + twa + "&userid=" + uid + "&type=" + type;
            window.open(url, cbReuseTab.checked ? urlBeta : "_blank");
        }
    }

    function callWindy(raceId, userId) {
        var baseURL = "https://www.windy.com";
        var r = races.get(raceId);
        var uinfo;

        if (userId) {
            uinfo = racefriends.get(raceId).uinfo[userId];
            if (uinfo === undefined) {
                alert("Can't find record for user id " + userId);
                return;
            }
        }
        var pos = r.curr.pos;
        if (uinfo) pos = uinfo.pos;
        var url = baseURL + "/?gfs," + pos.lat + "," + pos.lon + ",6,i:pressure,d:picker";
        var tinfo = "windy:" + r.url;
        window.open(url, cbReuseTab.checked ? tinfo : "_blank");
    }

    function callPolars(raceId) {
        var baseURL = "http://toxcct.free.fr/polars/?race_id=" + raceId;
        var race = races.get(raceId);

        var twa = Math.abs(roundTo(race.curr.twa || 20, 0));
        var tws = roundTo(race.curr.tws || 4, 1);

        if (!race.curr.tws || !race.curr.twa) {
            alert("Missing TWA and/or TWS, calling polars with TWA=" + twa + "°, TWS=" + tws + "kn");
        }

        var url = baseURL + "&tws=" + tws + "&twa=" + twa;

        for (option in race.curr.options) {
            url += "&" + race.curr.options[option] + "=true";
        }

        url += "&utm_source=VRDashboard";

        window.open(url, cbReuseTab.checked ? baseURL : "_blank");
    }

    // Greate circle distance
    function gcDistance(pos0, pos1) {
        // e = r · arccos(sin(φA) · sin(φB) + cos(φA) · cos(φB) · cos(λB – λA))
        var rlat0 = toRad(pos0.lat);
        var rlat1 = toRad(pos1.lat);
        var rlon0 = toRad(pos0.lon);
        var rlon1 = toRad(pos1.lon);
        return radius * gcAngle(rlat0, rlon0, rlat1, rlon1);
    }

    function gcAngle(rlat0, rlon0, rlat1, rlon1) {
        return Math.acos(Math.sin(rlat0) * Math.sin(rlat1) + Math.cos(rlat0) * Math.cos(rlat1) * Math.cos(rlon1 - rlon0));
    }

    function courseAngle(lat0, lon0, lat1, lon1) {
        var rlat0 = toRad(lat0);
        var rlat1 = toRad(lat1);
        var rlon0 = toRad(lon0);
        var rlon1 = toRad(lon1);
        var xi = gcAngle(rlat0, rlon0, rlat1, rlon1);
        var a = Math.acos((Math.sin(rlat1) - Math.sin(rlat0) * Math.cos(xi)) / (Math.cos(rlat0) * Math.sin(xi)));
        return (Math.sin(rlon1 - rlon0) > 0) ? a : (2 * Math.PI - a);
    }

    function addDistance (pos, distnm, angle, radiusnm) {
        var posR = {};
        posR.lat = toRad(pos.lat);
        posR.lon = toRad(pos.lon);
        var d = distnm / radiusnm;
        var angleR = toRad(angle);
        var dLatR = d * Math.cos(angleR);
        var dLonR = d * (Math.sin(angleR) / Math.cos(posR.lat + dLatR));
        return { "lat": toDeg(posR.lat + dLatR),
                 "lon": toDeg(posR.lon + dLonR) };
    }
    
    function toRad(angle) {
        return angle / 180 * Math.PI;
    }

    function toDeg(angle) {
        return angle / Math.PI * 180;
    }

    function toDMS(number) {
        var u = sign(number);
        number = Math.abs(number);
        var g = Math.floor(number);
        var frac = number - g;
        var m = Math.floor(frac * 60);
        frac = frac - m / 60;
        var s = Math.floor(frac * 3600);
        var cs = roundTo(360000 * (frac - s / 3600), 0);
        while (cs >= 100) {
            cs = cs - 100;
            s = s + 1;
        }
        return {
            "u": u,
            "g": g,
            "m": m,
            "s": s,
            "cs": cs
        };
    }

    function roundTo(number, digits) {
        if (number !== undefined && !isNaN(number)) {
            var scale = Math.pow(10, digits);
            return (Math.round(number * scale) / scale).toFixed(digits);
        } else {
            return "-";
        }
    }

    function sign(x) {
        return (x < 0) ? -1 : 1;
    }

    function pad0 (val, length=2, base=10) {
        var result = val.toString(base)
        while (result.length < length) result = '0' + result;
        return result;
    }

    function formatPosition(lat, lon) {
        var latDMS = toDMS(lat);
        var lonDMS = toDMS(lon);
        var latString = latDMS.g + "°" + pad0(latDMS.m) + "'" + pad0(latDMS.s) + '"';
        var lonString = lonDMS.g + "°" + pad0(lonDMS.m) + "'" + pad0(lonDMS.s) + '"';
        return latString + ((latDMS.u == 1) ? "N" : "S") + " " + lonString + ((lonDMS.u == 1) ? "E" : "W");
    }

    function switchMap(race) {
        initializeMap(race);
        races.forEach(function (r) {
            if (r.gdiv) {
                if (r == race) {
                    r.gdiv.style.display = "block";
                    r.gmap.fitBounds(r.gbounds);
                    
                } else {
                    r.gdiv.style.display = "none";
                }
            }
        });
    }
    
    function initializeMap(race) {
        if (!race || !race.legdata) return; // no legdata yet;

        if (!race.gdiv) {
            // Create div
            var divMap = document.createElement('div');
            divMap.style.height = "100%";
            divMap.style.display = "block";
            document.getElementById("tab-content4").appendChild(divMap);
            race.gdiv = divMap;
            
            // Create map
            var mapOptions = {
                mapTypeId: "terrain",
            };
            var map = new google.maps.Map(divMap, mapOptions);
            map.setTilt(45);
            race.gmap = map;

            // Customize & init map
            var bounds = race.gbounds = new google.maps.LatLngBounds();

            // start, finish
            var pos = new google.maps.LatLng(race.legdata.start.lat, race.legdata.start.lon);
            addmarker(map, bounds, pos, undefined, {
                color: "blue",
                text: "S"
            }, "Start: " + race.legdata.start.name + "\nPosition: " + formatPosition(race.legdata.start.lat, race.legdata.start.lon), "S", 10, 1);
            pos = new google.maps.LatLng(race.legdata.end.lat, race.legdata.end.lon);
            addmarker(map, bounds, pos, undefined, {
                color: "yellow",
                text: "F"
            }, "Finish: " + race.legdata.end.name + "\nPosition: " + formatPosition(race.legdata.end.lat, race.legdata.end.lon), "F", 10, 1);
            var fincircle = new google.maps.Circle({
                strokeColor: "#FF0000",
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillOpacity: 0,
                map: map,
                center: pos,
                radius: race.legdata.end.radius * 1852.0,
                zIndex: 9
            });

            // course
            var cpath = [];
            for (var i = 0; i < race.legdata.course.length; i++) {
                cpath.push(new google.maps.LatLng(race.legdata.course[i].lat, race.legdata.course[i].lon));
            }
            var arrow = {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW
            };
            var ccpath = new google.maps.Polyline({
                path: cpath,
                icons: [{
                    icon: arrow,
                    repeat: "50px"
                }],
                geodesic: true,
                strokeColor: "#FFFFFF",
                strokeOpacity: 0.5,
                strokeWeight: 1,
                zIndex: 4
            });
            ccpath.setMap(map);
            map.fitBounds(bounds);

        }
        updateMapWaypoints(race);
    }

    function clearTrack(map, db) {
        if (map[db])
            for (var i = 0; i < map[db].length; i++) map[db][i].setMap(null);
        map[db] = new Array();
    }

    
    var colors = [];
    colors.push("#000000");
    colors.push("#0080ff");
    colors.push("#ff0000");
    colors.push("#00cc00");
    colors.push("#d020ff");
    colors.push("#ffff00");
    colors.push("#00ffff");
    colors.push("#ffc000");
    colors.push("#8020ff");
    colors.push("#ff8000");
    colors.push("#a0ff00");
    colors.push("#0000ff");
    colors.push("#f00080");
    colors.push("#00ffa0");
    colors.push("#ffffff");

    function getColor(i) {
        if (i >= colors.length) {
            colors.push(randomColor());
            getColor(i);
        } else {
            return colors[i];
        }
    }
    
    function updateMapCheckpoints(race) {

        if (!race) return;
        
        var map = race.gmap;
        var bounds = race.gbounds;

        // checkpoints
        if (!race.legdata) return;
        if (!map) return;
        clearTrack(map,"_db_cp");
        
        var groupColors = [];
        for (var i = 0; i < race.legdata.checkpoints.length; i++) {

            var cp = race.legdata.checkpoints[i];
            var cp_name = "invsible";
            if (cp.display != "none") cp_name = cp.display;

            if (!groupColors[cp.group]) {
                groupColors[cp.group] = getColor(cp.group);
            }

            var position_s = new google.maps.LatLng(cp.start.lat, cp.start.lon);
            var position_e = new google.maps.LatLng(cp.end.lat, cp.end.lon);

            var c_sb = "#00FF00";
            var c_bb = "#FF0000";
            var zi = 8;
            if (cp.display == "none") {
                c_sb = "#448800";
                c_bb = "#884400";
                zi = 6;
            }

            var op = 1.0;
            var g_passed = false;
            if (race.gatecnt[cp.group - 1]) {
                g_passed = true;
                op = 0.5;
            } // mark/gate passed - semi transparent
            
            var label_g = "checkpoint " + cp.group + "." + cp.id +  ", type: " + cp_name + ", engine: " + cp.engine + ", name: " + cp.name + (g_passed ? ", PASSED" : "");
            var side_s =  cp.side ;
            var side_e = (cp.side == "stbd")?"port":"stbd";
            var label_s = label_g + ", side: " + side_s + "\nPosition: " + formatPosition(cp.start.lat, cp.start.lon);
            var label_e = label_g + ", side: " + side_e + "\nPosition: " + formatPosition(cp.end.lat, cp.end.lon);

            if (cp.side == "stbd") {
                map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol(c_sb, "C"), undefined, label_s, i, zi, op));
                map._db_cp.push(addmarker(map, bounds, position_e, pinSymbol(c_bb, "C"), undefined, label_e, i, zi, op));
            } else {
                map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol(c_bb, "C"), undefined, label_s, i, zi, op));
                map._db_cp.push(addmarker(map, bounds, position_e, pinSymbol(c_sb, "C"), undefined, label_e, i, zi, op));
            }

            if (cp.display == "gate") {
                if (cp.side == "stbd") {
                    map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol("#FFFF00", "RR"), undefined, label_s, i, 8, op));
                    map._db_cp.push(addmarker(map, bounds, position_e, pinSymbol("#FFFF00", "RL"), undefined, label_e, i, 8, op));
                } else {
                    map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol("#FFFF00", "RL"), undefined, label_s, i, 8, op));
                    map._db_cp.push(addmarker(map, bounds, position_e, pinSymbol("#FFFF00", "RR"), undefined, label_e, i, 8, op));
                }
            } else if (cp.display == "buoy") {
                if (cp.side == "stbd") {
                    map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol(c_sb, "RR"), undefined, label_s, i, 8, op));
                } else {
                    map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol(c_bb, "RL"), undefined, label_s, i, 8, op));
                }
            } else {
                if (cp.side == "stbd") {
                    map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol(c_sb, "RR"), undefined, label_s, i, zi, op));
                } else {
                    map._db_cp.push(addmarker(map, bounds, position_s, pinSymbol(c_bb, "RL"), undefined, label_s, i, zi, op));
                }
            }
            var path = [];
            path.push(position_s);
            path.push(position_e);
            var ppath = new google.maps.Polyline({
                path: path,
                strokeOpacity: 0.0,
                icons: [{
                    icon: pinSymbol(groupColors[cp.group], "DL", op),
                    repeat: "16px"
                }],
                geodesic: true,
                zIndex: cp.display == "none" ? 5 : 6
            });
            ppath.setMap(map);
            map._db_cp.push(ppath);
        }
    }

    function updateMapWaypoints(race) {

        var map = race.gmap;
        var bounds = race.gbounds;

        if (!race.curr) return; // current position unknown
        if (!map) return; // no map yet
        clearTrack(map,"_db_wp");

        // track wp
        var tpath = [];
        if (race.boatActions.length > 0) {
            if (race.boatActions[0].pos) {
                tpath.push(new google.maps.LatLng(race.curr.pos.lat, race.curr.pos.lon)); // boat
                for (var i = 0; i < race.boatActions[0].pos.length; i++) {
                    tpath.push(new google.maps.LatLng(race.boatActions[0].pos[i].lat, race.boatActions[0].pos[i].lon));
                }
                var ttpath = makeTTPath(tpath,"#FF00FF");
                ttpath.setMap(map);
                map._db_wp.push(ttpath);
            }
        }
    }

    function updateMapMe(race) {
        var map = race.gmap;

        if (!map) return; // no map yet
        clearTrack(map, "_db_me");

        // track
        var tpath = [];
        if (race.track) {
            for (var i = 0; i < race.track.length; i++) {
                tpath.push(new google.maps.LatLng(race.track[i].lat, race.track[i].lon));
            }
            var ttpath = makeTTPath(tpath, "#44FF44");
            ttpath.setMap(map);
            map._db_me.push(ttpath);
        }
        
        var bounds = race.gbounds;
        // boat
        var pos = new google.maps.LatLng(race.curr.pos.lat, race.curr.pos.lon);
        map._db_me.push(addmarker(map, bounds, pos, pinSymbol("#44FF44", "B", 0.7, race.curr.heading), undefined,
                                  "HDG: " + roundTo(race.curr.heading, 1) + " | TWA: " + roundTo(race.curr.twa, 1) + " | SPD: " + roundTo(race.curr.speed, 2), 'me', 20, 0.7));
        map.fitBounds(bounds);
    }

    function updateMapLeader(race) {
        var map = race.gmap;

        if (!map) return; // no map yet
        if (!race.curr) return;
        // if (race.curr.state != "racing") return;
        if (!race.curr.startDate) return;
        
        var d = new Date();
        var offset = d - race.curr.startDate;

        // track
        if (race.leaderTrack) {
            addGhostTrack(map, race.gbounds, race.leaderTrack, "Leader", "Leader: " + race.leaderName + " | Elapsed: " + formatDHMS(offset), offset, "_db_leader", "#3d403a");
        }
        if (race.myTrack) {
            addGhostTrack(map, race.gbounds, race.myTrack, "Best Attempt", "Best Attempt" + " | Elapsed: " + formatDHMS(offset), offset, "_db_self", "#4d504a");
        }
    }

    function addGhostTrack (map, bounds, ghostTrack, label, title, offset, db, color) {
        
        clearTrack(map, db);
        
        var tpath = [];
        var ghostStartTS = ghostTrack[0].ts;
        var ghostPosTS = ghostStartTS + offset;
        var ghostPos;
        for (var i = 0; i < ghostTrack.length; i++) {
            tpath.push(new google.maps.LatLng(ghostTrack[i].lat, ghostTrack[i].lon));
            if (!ghostPos) {
                if (ghostTrack[i].ts >= ghostPosTS) {
                    ghostPos = i;
                }
            }
        }
        var lineSymbol = {
            path: 'M 0,-1 0,1',
            strokeColor: color,
            strokeOpacity: 1,
            scale: 4
        };
        var ttpath = new google.maps.Polyline({
            path: tpath,
            geodesic: true,
            strokeOpacity: 0.0,
            strokeWeight: 1.5,
            icons: [{
                icon: lineSymbol,
                offset: '0',
                repeat: '20px'
            }],
            zIndex: 4
        });
        ttpath.setMap(map);
        map[db].push(ttpath);
        
        if (ghostPos) {
            var lat1 = ghostTrack[ghostPos].lat;
            var lon1 = ghostTrack[ghostPos].lon
            var lat0 = ghostTrack[Math.max(ghostPos - 1, 0)].lat;
            var lon0 = ghostTrack[Math.max(ghostPos - 1, 0)].lon;
            var heading = courseAngle(lat0, lon0, lat1, lon1) * 180 / Math.PI;
            var d = (ghostPosTS - ghostTrack[ghostPos - 1].ts ) / (ghostTrack[ghostPos].ts - ghostTrack[ghostPos - 1].ts)
            var lat = lat0 + (lat1-lat0) * d;
            var lon = lon0 + (lon1-lon0) * d;
            var pos = new google.maps.LatLng(lat, lon);
            map[db].push(addmarker(map, bounds, pos, pinSymbol(color, "B", 0.7, heading), label, title, 'leader', 20, 0.7));
        }
    }
    
    
    function updateMapFleet(race) {
        var map = race.gmap;
        var bounds = race.gbounds;

        if (!map) return; // no map yet
        clearTrack(map, "_db_op");

        // opponents/followed
        var rfd = racefriends.get(race.id);

        Object.keys(rfd.uinfo).forEach(function (key) {
            var elem = rfd.uinfo[key];
            var bi = boatinfo(key, elem);
            var pos = new google.maps.LatLng(elem.pos.lat, elem.pos.lon);
            
            var info = bi.name + " | HDG: " + roundTo(bi.heading, 1) + " | TWA: " + roundTo(bi.twa, 1) + " | SPD: " + roundTo(bi.speed, 2);
            if (elem.startDate && race.type == "record") {
                info += " | Elapsed: " + formatDHMS(elem.ts - elem.startDate);
            }
            map._db_op.push(addmarker(map, bounds, pos, pinSymbol(bi.bcolor, "B", 0.7, elem.heading), undefined, info, "U:" + key, 18, 0.7));
            // track
            var tpath = [];
            if (elem.track) {
                for (var i = 0; i < elem.track.length; i++) {
                    tpath.push(new google.maps.LatLng(elem.track[i].lat, elem.track[i].lon));
                }
                var ttpath = new google.maps.Polyline({
                    path: tpath,
                    geodesic: true,
                    strokeColor: bi.bcolor,
                    strokeOpacity: 0.6,
                    strokeWeight: 1,
                    zIndex: 4
                });
                ttpath.setMap(map);
                map._db_op.push(ttpath);
            }
        });
    }

    function makeTTPath (tpath, color) {
        return new google.maps.Polyline({
            path: tpath,
            geodesic: true,
            strokeColor: color,
            strokeOpacity: 0.7,
            strokeWeight: 1,
            zIndex: 4
        });
    }

    function addmarker(map, bounds, pos, symbol, label, title, mref, zi, op) {
        var marker = new google.maps.Marker({
            position: pos,
            map: map,
            icon: symbol,
            label: label,
            title: title,
            mref: mref,
            zIndex: zi,
            opacity: op
        });
        bounds.extend(pos);
        return marker;
    }

    var ps_pathmap = {
        C: ['M 0 0 C -2 -20 -10 -22 -10 -30 A 10 10 0 1 1 10 -30 C 10 -22 2 -20 0 0 z M -2 -30 a 2 2 0 1 1 4 0 2 2 0 1 1 -4 0', 1, 1],
        RL: ['M 0 -47 A 25 25 0 0 1 23.4923155196477 -13.4494964168583 M 3.9939080863394 -44.6505783192808 L 0 -47 L 4.68850079700712 -48.5898093313296 M 21.650635094611 -9.50000000000001 A 25 25 0 0 1 -19.1511110779744 -5.93030975783651 M 17.6190221917365 -7.2158849772096 L 21.650635094611 -9.50000000000001 L 20.6831999642124 -4.64473453846344 M -21.650635094611 -9.49999999999999 A 25 25 0 0 1 -4.34120444167328 -46.6201938253052 M -21.6129302780759 -14.1335367035096 L -21.650635094611 -9.49999999999999 L -25.3717007612195 -12.7654561302069', 1, 0],
        RR: ['M 0 -47 A 25 25 0 0 1 23.4923155196477 -13.4494964168583 M 22.6505783192808 -18.0060919136606 L 23.4923155196477 -13.4494964168583 L 26.5898093313296 -17.3114992029929 M 21.650635094611 -9.50000000000001 A 25 25 0 0 1 -19.1511110779744 -5.93030975783651 M -14.7841150227904 -4.3809778082635 L -19.1511110779744 -5.93030975783651 L -17.3552654615366 -1.31680003578759 M -21.650635094611 -9.49999999999999 A 25 25 0 0 1 -4.34120444167328 -46.6201938253052 M -7.86646329649038 -43.6129302780759 L -4.34120444167328 -46.6201938253052 L -9.23454386979305 -47.3717007612195', 1, 0],
        B: ['M -8 20 C -12 -5 0 -20 0 -20 C 0 -20 12 -5 8 20 L -8 20', 1, 1],
        DL: ['M 0,-1 0,1', 5, 0]
    };

    function pinSymbol(color, objtyp, opacity, rotation) {
        if (!opacity) opacity = 1.0;
        if (!rotation) rotation = 0.0;
        return {
            path: ps_pathmap[objtyp][0],
            fillColor: color,
            fillOpacity: ps_pathmap[objtyp][2] ? 1.0 : 0.0,
            strokeColor: ps_pathmap[objtyp][2] ? "#000000" : color,
            strokeWeight: 2,
            strokeOpacity: opacity,
            scale: ps_pathmap[objtyp][1],
            rotation: rotation
        };
    }

    function randomColor() {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        return "rgb(" + r + "," + g + "," + b + ")";
    }
    
    function saveOption(e) {
        localStorage["cb_" + this.id] = this.checked;
    }

    function getOption(name) {
        var value = localStorage["cb_" + name];
        if (value !== undefined) {
            cb = document.getElementById(name).checked = (value === "true");
        }
    }

    function readOptions() {
        getOption("auto_router");
        getOption("reuse_tab");
        getOption("local_time");
        getOption("nmea_output");
    }

    function addConfigListeners() {
        cbRouter.addEventListener("change", saveOption);
        cbReuseTab.addEventListener("change", saveOption);
        cbLocalTime.addEventListener("change", saveOption);
        cbNMEAOutput.addEventListener("change", saveOption);
    }

    function sendNMEA () {
        if (cbNMEAOutput.checked) {
            races.forEach(function (r) {
                if (r.curr) {
                    var rmc = formatGNRMC(r.curr);
                    var mwv = formatINMWV(r.curr);
                    sendSentence(r.id, "$" + rmc + "*" + nmeaChecksum(rmc)); 
                    sendSentence(r.id, "$" + mwv + "*" + nmeaChecksum(mwv)); 
                }
            });
        }
    }
        

    function sendSentence (raceId, sentence) {
        var request = new XMLHttpRequest();
        request.open("POST", "http://localhost:" + nmeaPort + "/nmea/" + raceId, true);
        request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        request.onerror = function (data) {
            console.log(data);
        };
        request.send(sentence);
    }

    function formatGNRMC (m) {
        // http://www.nmea.de/nmea0183datensaetze.html#rmc
        // https://gpsd.gitlab.io/gpsd/NMEA.html#_rmc_recommended_minimum_navigation_information
        var d = new Date(m.lastCalcDate);
        var s = "GNRMC";
        s += "," + formatHHMMSSSS(d) + ",A";                 // UTC time & status
        s += "," + formatNMEALatLon(Math.abs(m.pos.lat), 9); // Latitude & N/S
        s += "," + ((m.pos.lat < 0) ? "S":"N");
        s += "," + formatNMEALatLon(Math.abs(m.pos.lon), 10); // Longitude & E/W
        s += "," + ((m.pos.lon < 0) ? "W":"E");
        s += "," + roundTo(m.speed, 1);                      // SOG  
        s += "," + roundTo(m.heading, 1);                    // Track made good 
        s += "," + formatDDMMYY(d);                          // Date
        s += ",,";                                           // 
        s += ",A";                                           // Valid  
        return s;
    }

    function formatINMWV (m) {
        // $INMWV Wind Speed and Angle
        var s = "INMWV";
        var pTWA = (m.twa > 0)? m.twa: m.twa + 360; 
        s += "," + pad0(roundTo(pTWA, 2), 6) + ",T";
        s += "," + pad0(roundTo(m.tws, 2), 5) + ",N";
        s += ",A"
        return s;
    }
    
    function formatNMEALatLon (l, len) {
        var deg = Math.trunc(l);
        var min = roundTo((l - deg) * 60, 4);
        var result = "" + deg + min;
        return pad0(result, len);
    }
    
    function nmeaChecksum (s) {
        var sum = 0;
        for (var i = 0; i < s.length; i++) {
            sum ^= s.charCodeAt(i);
        }
        return pad0(sum, 2, 16).toUpperCase();
    }
    
    
    var initialize = function () {
        var manifest = chrome.runtime.getManifest();
        document.getElementById("lb_version").innerHTML = manifest.version;

        lbBoatname = document.getElementById("lb_boatname");
        lbTeamname = document.getElementById("lb_teamname");
        selRace = document.getElementById("sel_race");
        selFriends = document.getElementById("sel_skippers");
        cbFriends = document.getElementById("sel_friends");
        cbOpponents = document.getElementById("sel_opponents");
        cbTeam = document.getElementById("sel_team");
        cbTop = document.getElementById("sel_top");
        cbReals = document.getElementById("sel_reals");
        cbSponsors = document.getElementById("sel_sponsors");
        cbInRace = document.getElementById("sel_inrace");
        cbRouter = document.getElementById("auto_router");
        cbReuseTab = document.getElementById("reuse_tab");
        cbLocalTime = document.getElementById("local_time");
        cbNMEAOutput = document.getElementById("nmea_output");
        lbRace = document.getElementById("lb_race");
        lbCurTime = document.getElementById("lb_curtime");
        lbCurPos = document.getElementById("lb_curpos");
        lbHeading = document.getElementById("lb_heading");
        lbTWS = document.getElementById("lb_tws");
        lbTWD = document.getElementById("lb_twd");
        lbTWA = document.getElementById("lb_twa");
        lbDeltaD = document.getElementById("lb_delta_d");
        lbDeltaT = document.getElementById("lb_delta_t");
        lbSpeedC = document.getElementById("lb_curspeed_computed");
        lbSpeedR = document.getElementById("lb_curspeed_reported");
        lbSpeedT = document.getElementById("lb_curspeed_theoretical");
        divRaceStatus = document.getElementById("raceStatus");
        divRecordLog = document.getElementById("recordlog");
        divRecordLog.innerHTML = makeTableHTML();
        cbRawLog = document.getElementById("cb_rawlog");
        divRawLog = document.getElementById("rawlog");
        initRaces();

        chrome.storage.local.get("polars", function (items) {
            if (items["polars"] !== undefined) {
                console.log("Retrieved " + items["polars"].filter(function (value) {
                    return value != null
                }).length + " polars.");
                polars = items["polars"];
            }
        });

        // Send NMEA data every 10 seconds
        window.setInterval(sendNMEA, nmeaINInterval);
        
        initialized = true;
    }

    var callRouter = function (raceId, userId) {
        var beta = false;

        if (typeof raceId === "object") { // button event
            raceId = selRace.value;
            beta = selRace.options[selRace.selectedIndex].betaflag;
        } else { // new tab
            var race = selRace.options[selRace.selectedIndex];
            if (race && race.value == raceId) {
                beta = race.betaflag;
            }
        }

        if (!races.get(raceId)) {
            alert("Unsupported race #" + raceId);
        } else if (races.get(raceId).curr === undefined) {
            alert("No position received yet. Please retry later.");
        } else if (races.get(raceId).url === undefined) {
            alert("Unsupported race, no router support yet.");
        } else {
            callRouterZezo(raceId, userId, beta);
        }
    }

    function reInitUI(newId) {
        if (currentUserId != undefined && currentUserId != newId) {
            // Re-initialize statistics
            disableRaces();
            races.forEach(function (race) {
                race.tableLines = [];
                race.curr = undefined;
                race.prev = undefined;
                race.lastCommand = undefined;
                race.rank = undefined;
                race.dtl = undefined;
                race.gmap = undefined;
            });
            divRaceStatus.innerHTML = makeRaceStatusHTML();
            divRecordLog.innerHTML = makeTableHTML();
            divFriendList.innerHTML = makeFriendsHTML();
        };
    }

    var onEvent = function (debuggeeId, message, params) {
        if (tabId != debuggeeId.tabId)
            return;

        if (message == "Network.webSocketFrameSent") {
            // Append message to raw log
            if (cbRawLog.checked) {
                divRawLog.innerHTML = divRawLog.innerHTML + "\n" + ">>> " + params.response.payloadData;
            }

            // Map to request type via requestId
            var request = JSON.parse(params.response.payloadData);
            requests.set(request.requestId, request);

            if (request.eventKey == "Game_StartAttempt") {
                var raceId = getRaceLegId(request);
                var race = races.get(raceId);
                if (race) {
                    race.prev = undefined;
                    race.curr = undefined;
                }
            }

        } else if (message == "Network.webSocketFrameReceived") {
            // Append message to raw log
            if (cbRawLog.checked) {
                divRawLog.innerHTML = divRawLog.innerHTML + "\n" + "<<< " + params.response.payloadData;
            }
            // Work around broken message
            var jsonString = params.response.payloadData.replace(/\bNaN\b|\bInfinity\b/g, "null");
            var response = JSON.parse(jsonString);
            if (response == undefined) {
                console.log("Invalid JSON in payload");
            } else {
                var responseClass = response["@class"];
                if (responseClass == ".AccountDetailsResponse") {
                    reInitUI(response.userId);
                    currentUserId = response.userId;
                    lbBoatname.innerHTML = response.displayName;
                    if (response.scriptData.team) {
                        lbTeamname.innerHTML = "&nbsp; <b>Team : </b>" + response.scriptData.team.name;
                        currentTeam = response.scriptData.team.name;
                    }
                } else if (responseClass == ".LogEventResponse") {
                    // Get the matching request and Dispatch on request type
                    var request = requests.get(response.requestId);

                    // Dispatch on request type
                    if (request == undefined) {
                        // Probably only when debugging.
                        // -- save and process later ?
                        console.warn(responseClass + " " + response.requestId + " not found");
                    } else if ((request.eventKey == "LDB_GetLegRank"
                                || request.eventKey == "LDB_GetGateRank")
                               && response.scriptData.me) {
                        var raceId = getRaceLegId(request);
                        var race = races.get(raceId);
                        // Re-init UI (only if user has changed)
                        reInitUI(response.scriptData.me._id);
                        // Use this response to update User/Boat info if VRDashboard is enabled only after login.
                        currentUserId = response.scriptData.me._id;
                        lbBoatname.innerHTML = response.scriptData.me.displayName;
                        // Own boatname is also unknown if login message was not seen
                        var myUInfo = racefriends.get(raceId).uinfo[currentUserId];
                        if (myUInfo && !myUInfo.displayName) {
                            myUInfo.displayName = response.scriptData.me.displayName;
                        }
                        if (response.scriptData.team) {
                            lbTeamname.innerHTML = "&nbsp; <b>Team :</b>" + response.scriptData.team.name;
                            currentTeam = response.scriptData.team.name;
                        }
                        // Retrieve rank in current race
                        if (race != undefined) {
                            race.rank = response.scriptData.me.rank;
                            race.dtl = response.scriptData.me.distance - response.scriptData.res[0].distance;
                            divRaceStatus.innerHTML = makeRaceStatusHTML();
                        }
                    } else if (request.eventKey == "Leg_GetList") {
                        // Contains destination coords, ice limits
                        // ToDo: contains Bad Sail warnings. Show in race status table?
                        var legInfos = response.scriptData.res;
                        legInfos.map(function (legInfo) {
                            var rid = legId(legInfo);
                            var race = races.get(rid);
                            if (race === undefined) {
                                race = {
                                    id: rid,
                                    name: legInfo.legName,
                                    legName: legInfo.legName,
                                    source: "vr_leglist"
                                };
                                initRace(race, true);
                            } else {
                                race.legName = legInfo.legName; // no name yet (created by updatePosition)
                                // renameRace(rid, race.name);
                            }
                            race.rank = legInfo.rank;
                            race.type = legInfo.raceType;
                            race.legnum = legInfo.legNum;
                            race.status = legInfo.status;
                            race.record = legInfo.record;
                            if (legInfo.problem == "badSail") {} else if (legInfo.problem == "...") {}
                        });
                        divRaceStatus.innerHTML = makeRaceStatusHTML();
                    } else if (request.eventKey == "Game_GetBoatState") {
                        // First boat state message, only sent for the race the UI is displaying
                        // No boatstate if boat is not registered yet
                        if (response.scriptData.boatState) {
                            var raceId = getRaceLegId(response.scriptData.boatState._id);
                            var race = races.get(raceId);
                            var uid = response.scriptData.boatState._id.user_id;
                            if (!currentUserId) {
                                currentUserId = uid;
                            }
                            race.legdata = response.scriptData.leg;
                            if (response.scriptData.boatActions) {
                                race.boatActions = response.scriptData.boatActions;
                            }
                            initializeMap(race);
                            // Don't try old race_id, messages will be misdirected
                            updatePosition(response.scriptData.boatState, race);
                            updateMapMe(race);

                            if (cbRouter.checked) {
                                callRouter(raceId);
                            }
                            // Provide own info on Fleet tab
                            updateFriendUinfo(raceId, "usercard", uid, response.scriptData.boatState);
                        }
                    } else if (request.eventKey == "Game_RefreshBoatState") {
                        // New message - does this replace the boatStatePush ?
                        var raceId = getRaceLegId(response.scriptData.boatState._id);
                        var race = races.get(raceId);
                        if (response.scriptData.boatActions) {
                            race.boatActions = response.scriptData.boatActions;
                        }
                        // Don't try old race_id, messages will be misdirected
                        updatePosition(response.scriptData.boatState, race);
                        updateMapMe(race);
                    } else if (request.eventKey == "Game_AddBoatAction") {
                        // First boat state message, only sent for the race the UI is displaying
                        var raceId = getRaceLegId(request);
                        var race = races.get(raceId);
                        if (race != undefined) {
                            race.lastCommand = {
                                request: request,
                                rc: response.scriptData.rc
                            };
                            addTableCommandLine(race);
                            divRaceStatus.innerHTML = makeRaceStatusHTML();
                        }
                    } else if (request.eventKey == "Meta_GetPolar") {
                        // Always overwrite cached data...
                        polars[response.scriptData.polar._id] = response.scriptData.polar;
                        chrome.storage.local.set({
                            "polars": polars
                        });
                        console.info("Stored polars " + response.scriptData.polar.label);
                    } else if (request.eventKey == "Shop_GetCardsPack") {
                        var card = races.get(getRaceLegId(request)).curr.soloCard;
                        card.code = response.scriptData.packs[0].code;
                        card.ts = response.scriptData.tsSoloCard;
                        divRaceStatus.innerHTML = makeRaceStatusHTML();
                    } else if (request.eventKey == "Game_GetFollowedBoats") {
                        var raceId = getRaceLegId(request);
                        var race = races.get(raceId);
                        updateFriends(raceId, "followed", response.scriptData.res);
                        updateMapFleet(race);
                        if (raceId == selRace.value) {
                            divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
                        }
                    } else if (request.eventKey == "Game_GetOpponents") {
                        var raceId = getRaceLegId(request);
                        var race = races.get(raceId);
                        updateFriends(raceId, "opponents", response.scriptData.res);
                        updateMapFleet(race);
                        if (raceId == selRace.value) {
                            divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
                        }
                    } else if (request.eventKey == "Game_GetFleet") {
                        var raceId = getRaceLegId(request);
                        var race = races.get(raceId);
                        updateFriends(raceId, "fleet", response.scriptData.res);
                        updateMapFleet(race);
                        if (raceId == selRace.value) {
                            divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
                        }
                    } else if (request.eventKey == "Game_GetBoatTrack") {
                        var raceId = getRaceLegId(request);
                        var rfd = racefriends.get(raceId);
                        var race = races.get(raceId);
                        var uid = request.user_id;
                        var ndata = rfd.uinfo[uid];

                        if (race) {
                            if (uid == race.curr._id.user_id) {
                                race.track = response.scriptData.track;
                                updateMapMe(race);
                            } else if (ndata) {
                                ndata.track = response.scriptData.track;
                                updateMapFleet(race);
                            }
                        }
                    } else if (request.eventKey == "Game_GetGhostTrack") {
                        var raceId = getRaceLegId(request);
                        var rfd = racefriends.get(raceId);
                        var race = races.get(raceId);
                        var uid = request.user_id;
                        var ndata = rfd.uinfo[uid];

                        if (race) {
                            race.leaderTrack = response.scriptData.leaderTrack;
                            race.leaderName =  response.scriptData.leaderName;
                            if (response.scriptData.myTrack) {
                                race.myTrack = response.scriptData.myTrack;
                            }
                            updateMapLeader(race);
                        }
                    } else if (request.eventKey == "User_GetCard") {
                        var raceId = getRaceLegId(request);
                        var uid = request.user_id;
                        response.scriptData.legInfos.baseInfos = response.scriptData.baseInfos; // tweak record
                        updateFriendUinfo(raceId, "usercard", uid, response.scriptData.legInfos);
                        if (raceId == selRace.value) {
                            divFriendList.innerHTML = makeFriendsHTML(racefriends.get(selRace.value));
                        }
                        var race = races.get(raceId);
                        updateMapFleet(race);
                    }
                } else if (responseClass == ".ScriptMessage") {
                    // There is no request for .ScriptMessages.
                    // The ScriptMessage type can be :
                    //      extCode=boatStatePush
                    //      extCode=messagePush
                    //      extCode=teamMessage
                    if (response.extCode == "boatStatePush") {
                        var raceId = getRaceLegId(response.data._id);
                        var race = races.get(raceId);
                        updatePosition(response.data, race);
                        updateMapMe(race);
                        if (currentUserId) {
                            updateFriendUinfo(raceId, "usercard", currentUserId, response.data);
                        }
                    }
                }
            }
        }
    }

    return {
        // The only point of initialize is to wait until the document is constructed.
        initialize: initialize,
        // Useful functions
        callRouter: callRouter,
        changeRace: changeRace,
        changeFriends: changeFriends,
        onEvent: onEvent,
        clearLog: clearLog,
        tableClick: tableClick,
        resize: resize,
        readOptions: readOptions,
        addConfigListeners: addConfigListeners
    }
}();


var tabId = parseInt(window.location.search.substring(1));


window.addEventListener("load", function () {

    controller.initialize();

    document.getElementById("bt_router").addEventListener("click", controller.callRouter);
    document.getElementById("sel_race").addEventListener("change", controller.changeRace);
    document.getElementById("sel_skippers").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_friends").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_opponents").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_team").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_top").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_reals").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_sponsors").addEventListener("change", controller.changeFriends);
    document.getElementById("sel_inrace").addEventListener("change", controller.changeFriends);
    document.getElementById("bt_clear").addEventListener("click", controller.clearLog);
    document.addEventListener("click", controller.tableClick);
    document.addEventListener("resize", controller.resize);

    controller.readOptions();
    controller.addConfigListeners();

    chrome.debugger.sendCommand({
        tabId: tabId
    }, "Network.enable", function () {
        // just close the dashboard window if debugger attach fails
        // wodks on session restore too

        if (chrome.runtime.lastError) {
            window.close();
            return;
        }
    });
    chrome.debugger.onEvent.addListener(controller.onEvent);
});

