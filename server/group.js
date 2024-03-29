var async = require('async');
var mongoose = require('mongoose');

var Enrollment = require('./enrollment.js');
var QueueEntry = require('./queue_entry.js');
var User = require('./user.js');

var groupSchema = new mongoose.Schema({
  name: String,
  maxEntries: Number,
  _user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

groupSchema.methods.fix = function (cb) {
  Enrollment
    .find({_group: this._id})
    .exists('endDate', false)
    .populate("_queueEntry")
    .exec(function(err, enrollments) {
      var count = enrollments.length;
      if (count > this.maxEntries) {
        var enrollment = enrollments[0];
        for (var i = 1; i < enrollments.length; i++) {
          if (enrollments[i]._queryEntry.priority < enrollment.priority) {
            enrollment = enrollments[i]._queryEntry;
          }
        }

        enrollment.endDate = Date.now();
        enrollment.save();
      }
      if (count >= this.maxEntries) {
        minPriority = this.maxEntries;
        for (var j in enrollments) {
          if (enrollments[j].endDate) {
            minPriority = Math.min(minPriority, enrollments[j]._queryEntry.priority);
          }
        }
        QueueEntry.find( {_group: this._id}, function(err, entries) {
          entries.forEach(function(entry) {
            if (entry.priority < minPriority) {
              entry.valid = false;
            } else {
              entry.valid = true;
            }
            entry.save();
          });
        });

      }
      cb();
  });
};

groupSchema.methods.addEnrollment = function (courseId, cb) {
  console.log('course id is ');
  console.log(courseId);
  var enrollment = new Enrollment({
    startDate: Date.now(),
    _group: this._id,
    _course: courseId,
    _user: this._user
  });
  enrollment.save(cb);
};

groupSchema.methods.addQueueEntry = function(courseId, cb) {
  var queueEntry = new QueueEntry({
    priority: 1,
    created: Date.now(),
    valid: true,
    _group: this._id,
    _course: courseId
  });
  queueEntry.save(cb);
};

groupSchema.methods.getActiveEnrollment_SingleGroup = function (courseId, cb) {
  var group = this;
  Enrollment.forGroup(this, function (err, enrollments) {
    async.reduce(enrollments, null, function (memo, item, callback) {
      if (!item.endDate && item._course._id.toString() == courseId) {
        memo = item;
      }
      callback(null, memo);
    }, function (err, result) {
      cb(result);
    });
  });
};

groupSchema.statics.getActiveEnrollment = function (userId, courseId, cb) {
  Group.find({_user: userId}, function (err, groups) {
    async.reduce(groups, null, function (memo, item, callback) {
      item.getActiveEnrollment_SingleGroup(courseId, function (result) {
        if (result !== null) {
          memo = result;
        }
        callback(null, memo);
      });
    }, function (err, result) {
      cb(result);
    });
  });
};

groupSchema.methods.getQueueEntry_SingleGroup = function (courseId, cb) {
  var group = this;
  QueueEntry.findOne({_course: courseId, _group: group._id, valid: true},
    function(err, result) {
      cb(result);
  });
};

groupSchema.statics.getQueueEntry = function (userId, courseId, cb) {
  Group.find({_user: userId}, function (err, groups) {
    async.reduce(groups, null, function (memo, item, callback) {
      item.getQueueEntry_SingleGroup(courseId, function (result) {
        if (result !== null) {
          memo = result;
        }
        callback(null, memo);
      });
    }, function (err, result) {
      cb(result);
    });
  });
};

groupSchema.statics.getWithEnrollments = function (userId, callback) {
  Group.find(
    { _user: userId },
    function (err, groups) {
      console.log(groups);
      async.map(groups, function (group, cb) {
        Enrollment.forGroup(group, function (err, enrollments) {
          group.enrollments = enrollments;
          cb(null, group);
        });
      }, callback);
  });
};

groupSchema.statics.addGroup = function (userId, name, maxEntries, cb) {
  var group = new Group({
    maxEntries: maxEntries,
    _user: userId
  });
  group.save(cb);
};

groupSchema.statics.reserveIfFree = function (userId, maxEntries, cb) {
  console.log('userId is ' + userId);
  User.findByIdAndUpdate(userId, {$inc: {enrolledIn: maxEntries}}, {'new': true}, function (err, user) {
    if (err || !user) {
      return cb(false);
    }
    if (user.enrolledIn > user.maxSimultaneous()) {
      user.enrolledIn -= maxEntries;
      user.save(function () {
        cb(false);
      });
    } else {
      cb(true);
    }
  });
};

var Group = mongoose.model('Group', groupSchema);

module.exports = Group;
