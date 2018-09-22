/**
 В ходе выполнения задания, я использовал уже написанный вами метод для аггрегации данных по опросам.
  Кажется он максимально подходил под решение первого задания. Единственное там оператор $in не работал,
  так как ObjectId на INT поменяли для тестового задания, поэтому я parseInt туда дописал.

 В ходе выполнения второй части, я добавил 2 поля в модель опроса
  isClosed: { type: Boolean, default: false} - флаг означающий что опрос завершён.
  winnerOption: { type: ObjectId, ref: 'PollOption' }  - ссылка на опцию, набравшую наибольшее число очков.

  Я оставил остальные комментарии на добавленных мной методах.
 */

const mongoose = require('mongoose')
const { extend, isArray } = require('lodash')

const { is } = require('./utils')
const ObjectID = require('mongodb').ObjectID
const ObjectId = mongoose.Schema.Types.ObjectId

const targetModels = [ 'Post' ]

const model = new mongoose.Schema(extend({
  userId: { type: Number, required: true }, // в реальном проекте тут – ссылка на модель Users. Чтобы ты смог тут что-то пробовать – заменил на числовое поле
  //
  votes: 0, // счетчик голосов
  //
  title: { type: String, required: true }, // название опроса
  multi: { type: Boolean, default: false }, // флаг, сообщающий о том, что в опросе может выбрано несколько вариантов ответа
  //
  target: { // привязка опроса к какой-либо внещней сущности, в данном случае – к постам
    model: { type: String, enum: targetModels },
    item: { type: Number } // тут тоже облегчил – убрал связь с сторонними моделями
  },
  isClosed: { type: Boolean, default: false},
  winnerOption: { type: ObjectId, ref: 'PollOption' }
}, is))

model.index({ 'userId': 1 })
model.index({ 'target.item': 1 })

model.virtual('options', {
  ref: 'PostPollOption',
  localField: '_id',
  foreignField: 'pollId'
})

model.statics.PollOption = require('./option')

model.statics.makePoll = async function (userId, target = {}, options = [], title, multi = false) {
  const model = this
  if (!target.model || !target.item) throw new Error('no target specified')
  if (!options.length) throw new Error('no poll options specified')
  if (!title) throw new Error('no title specified')

  let poll = await model.create({ target, userId, title, multi })
  await poll.setOptions(options)
  return poll
}

model.methods.setOptions = function (options) {
  const poll = this

  return Promise.all(options.map(option => (
    mongoose.models.PollOption.create({ pollId: poll._id, value: option })
  )))
}

model.methods.vote = function (userId, data = []) {
  const poll = this

  return mongoose.models.PollOption.update(
    {
      _id: { $in: data.map(el => ObjectID(el)) },
      pollId: poll._id
    },
    { $addToSet: { votes: userId } },
    { multi: true }
  )
}

model.methods.editOptions = async function (options = []) {
  const poll = this

  let missed = []
  let pollOptions = await Promise.all(options.map(async option => {
    let [ pollOption ] = await mongoose.models.PollOption.find({ pollId: poll._id, value: option }).select('_id value').limit(1)
    if (pollOption) return pollOption
    missed.push(option)
    return null
  }))

  await mongoose.models.PollOption.update(
    {
      pollId: poll._id,
      _id: { $nin: pollOptions.filter(el => !!el).map(el => el._id) }
    },
    { enabled: false },
    { multi: true }
  )

  return poll.setOptions(missed)
}

model.statics.getPollInfo = function (params = {}, options = {}) {
  const model = this
  return model.aggregate([
    { $match: params },
    { $lookup: {
      from: 'polloptions',
      localField: '_id',
      foreignField: 'pollId',
      as: 'options'
    }},
    { $unwind: '$options' },
    { $match: {
      'options.enabled': true
    }},
    { $project: {
      _id: 1,
      title: 1,
      multi: 1,
      target: 1,
      options: {
        _id: 1,
        value: '$options.value',
        votes: { $size: '$options.votes' },
        isVoted: { $in: [options.userId ? parseInt(options.userId) : null, '$options.votes' ] }
      }
    }},
    { $group: {
      _id: {
        _id: '$_id',
        title: '$title',
        multi: '$multi',
        target: '$target'
      },
      options: { $push: '$options' },
      votes: { $sum: '$options.votes' },
      isVoted: { $push: '$options.isVoted' }
    }},
    { $project: {
      _id: '$_id._id',
      title: '$_id.title',
      multi: '$_id.multi',
      target: '$_id.target',
      isVoted: { $in: [ true, '$isVoted' ] },
      votes: 1,
      options: 1
    }},
  ])
}

model.statics.getPostPolls = async function (params = {}) {
  const model = this
  let match = {
    'target.model': 'Post',
    enabled: true
  }

  if (params.postId) match['target.item'] = { $in: isArray(params.postId) ? params.postId : [ params.postId ] }

  let data = await model.getPollInfo(match, { userId: params.userId })

  return data.reduce((obj, item) => {
    obj[item.target.item] = item
    return obj
  }, {})
}


//=========================================Новые методы============================================
/**
  Статический метод модели, для аггрегации опросов в которых участвовал пользователь.
  Я использовал часть уже написанного запроса и добавил туда $match по голосам перед $unwind,
  чтобы получать только те Опросы, в которых участовал пользователь.
  Можно было бы сделать просто match по userId в самом начале, так как такое поле есть в модели опроса,
  но я думаю что если в голосовании участвует несколько пользователей, то лучше так не делать.
*/

model.statics.getUserPolls = async function (params = {}, options = {}) {
  const model = this;
  let data = await model.aggregate([
    { $match: params },
    {
      $lookup: {
        from: 'polloptions',
        localField: '_id',
        foreignField: 'pollId',
        as: 'options'
      }
    },
    {
      $match: {
        'options.enabled': true,
        'options.votes': { $in: [options.userId ? parseInt(options.userId) : null, '$options.votes'] }
      }
    },
    { $unwind: '$options' },
    {
      $project: {
        _id: 1,
        title: 1,
        multi: 1,
        target: 1,
        options: {
          _id: 1,
          value: '$options.value',
          votes: { $size: '$options.votes' },
          isVoted: { $in: [options.userId ? parseInt(options.userId) : null, '$options.votes'] }
        }
      }
    },
    {
      $group: {
        _id: {
          _id: '$_id',
          title: '$title',
          multi: '$multi',
          target: '$target'
        },
        options: { $push: '$options' },
        votes: { $sum: '$options.votes' },
        isVoted: { $push: '$options.isVoted' }
      }
    },
    {
      $project: {
        _id: '$_id._id',
        title: '$_id.title',
        multi: '$_id.multi',
        target: '$_id.target',
        isVoted: { $in: [true, '$isVoted'] },
        votes: 1,
        options: 1
      }
    },
  ]);
  
  return data.reduce((obj, item) => {
    obj[item.target.item] = item
    return obj
  }, {})
}

//Простой метод для изменения поля isClosed.
model.methods.closePoll = async function () {
  let poll = this
  poll.isClosed = true;
  await poll.save();
  return poll
}

/** 
  Метод для установки победителя опроса.
  Аггрегирует все варианты ответов опроса и сортирует их по количеству голосов,
  После отдаёт один ответ через $limit
*/

model.methods.setWinner = async function () {
  let poll = this;
  const model = mongoose.models.Poll;
  const winnerLookup = await model.aggregate([
    { $match: { _id: ObjectID(poll._id) } },
    {
      $lookup: {
        from: 'polloptions',
        localField: '_id',
        foreignField: 'pollId',
        as: 'options'
      }
    },
    { $unwind: '$options' },
    {
      $match: {
        'options.enabled': true
      }
    },
    {
      $project: {
        _id: '$options._id',
        votes: { $size: '$options.votes' },
      },
    },
    { $sort: { "votes": -1 } },
  ]);
  poll.winnerOption = winnerLookup[0]; 
  await poll.save();
  return poll
}


module.exports = mongoose.model('Poll', model)
