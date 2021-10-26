const app = require("@live-change/framework").app()
const validators = require("../validation")

require('../../i18n/ejs-require.js')
const i18n = require('../../i18n')

const definition = app.createServiceDefinition({
  name: 'room',
  eventSourcing: true,
  validators
})

const { getAccess, hasRole, checkIfRole, getPublicInfo } =
    require("../access-control-service/access.js")(definition)

/*
async function checkIfOwner(room, { client, visibilityTest }) {
  if(visibilityTest) return true
  const access = getAccess('room', room, client)
  return hasRole(access, ['owner'])
}


async function checkIfMember(project, { client, visibilityTest }) {
  if(!client.user) return false
  if(visibilityTest) return true
  const cursor = await Membership.run(Membership.table.getAll([client.user, 'Project', project], { index: 'membership' }))
  const memberships = await cursor.toArray()
  const membership = memberships[0]
  return !!membership
}
*/

const roomFields = {
  name: {
    type: String
  },
}

const Room = definition.model({
  name: "Room",
  properties: {
    ...roomFields,
    slug: {
      type: String
    }
  },
  indexes: {
  },
  crud: {
    deleteTrigger: true,
    writeOptions: {
      access: (params, { client, service, visibilityTest }) => {
        return client.roles.includes('admin')
      }
    }
  },
})

definition.view({
  name: "room",
  properties: {
    room: {
      type: Room
    }
  },
  returns: {
    type: Room
  },
  access: ({ room }, context) =>
      checkIfRole('room', room, ['reader', 'speaker', 'vip', 'moderator', 'owner'], context),
  async daoPath({ room }, { client, service }, method) {
    console.log("ROOM PATH", Room.path(room))
    return Room.path(room)
  }
})

definition.action({
  name: "createRoom",
  properties: {
    ...roomFields,
    publicUserAccessRole: {
      type: String
    },
    publicGuestAccessRole: {
      type: String
    }
  },
  access: (params, { client }) => true,//!!client.user,
  async execute(params, { client, service }, emit) {
    const room = app.generateUid()
    let data = {}
    for(let key in roomFields) {
      data[key] = params[key]
    }

    const slug = await service.triggerService('slugs', {
      type: "CreateSlug",
      group: "room",
      title: params.name,
      to: room
    })
    data.slug = slug
    await service.triggerService('slugs', {
      type: "TakeSlug",
      group: "room",
      path: room,
      to: room,
      redirect: slug
    })

    let users = []
    let sessions = []
    if(client.user) {
      users.push({
        user: client.user,
        role: "owner"
      })
    } else {
      sessions.push({
        session: client.sessionId,
        role: "owner"
      })
    }

    await service.triggerService('accessControl', {
      type: "createAccess",
      toType: 'room',
      toId: room,
      publicUserAccessRole: params.publicUserAccessRole,
      publicGuestAccessRole: params.publicGuestAccessRole,
      users,
      sessions
    })

    emit({
      type: 'RoomCreated',
      room,
      data: data
    })

    return { room, slug }
  }
})

module.exports = definition

async function start () {
  if(!app.dao) {
    await require('@live-change/server').setupApp({})
    await require('@live-change/elasticsearch-plugin')(app)
  }

  process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  })

  app.processServiceDefinition(definition, [...app.defaultProcessors])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({

  }))*/
}

if (require.main === module) start().catch(error => {
  console.error(error)
  process.exit(1)
})


