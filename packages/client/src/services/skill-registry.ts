import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { FilesystemBackend, listSkills } from 'deepagents'
import type { FilesystemPermission } from 'deepagents'
import type { AgentSkill } from '@data-agent/shared'

const skillsDirectoryUrl = new URL('../../skills/', import.meta.url)

export const PROJECT_SKILLS_DIRECTORY = fileURLToPath(skillsDirectoryUrl)

export type ResolvedAgentSkills = {
  names: string[]
  sources: string[]
  instructions: string
}

export class UnknownAgentSkillsError extends Error {
  readonly status = 400

  constructor(names: string[]) {
    super(`未找到可用 Skill：${names.join('、')}`)
  }
}

function listProjectSkillMetadata() {
  return listSkills({
    userSkillsDir: null,
    projectSkillsDir: PROJECT_SKILLS_DIRECTORY,
  })
}

export function listAvailableAgentSkills(): AgentSkill[] {
  return listProjectSkillMetadata().map((skill) => ({
    name: skill.name,
    description: skill.description,
  }))
}

export async function resolveAgentSkills(
  requestedNames: readonly string[],
): Promise<ResolvedAgentSkills> {
  const selectedNames = [...new Set(requestedNames)]
  const availableSkills = new Map(
    listProjectSkillMetadata().map((skill) => [skill.name, skill]),
  )
  const unknownNames = selectedNames.filter((name) => !availableSkills.has(name))

  if (unknownNames.length > 0) {
    throw new UnknownAgentSkillsError(unknownNames)
  }

  const instructions = await Promise.all(
    selectedNames.map(async (name) => {
      const skill = availableSkills.get(name)
      if (!skill) throw new UnknownAgentSkillsError([name])
      const content = (await readFile(skill.path, 'utf8')).trim()
      return [`--- 已加载 Skill: ${skill.name} ---`, content, '--- Skill 结束 ---'].join(
        '\n',
      )
    }),
  )

  return {
    names: selectedNames,
    sources: selectedNames.map((name) => `/${name}/`),
    instructions: instructions.join('\n\n'),
  }
}

export function createSkillsBackend(): FilesystemBackend {
  return new FilesystemBackend({
    rootDir: PROJECT_SKILLS_DIRECTORY,
    virtualMode: true,
  })
}

export function createSkillPermissions(
  skillNames: readonly string[],
): FilesystemPermission[] {
  const permissions: FilesystemPermission[] = []
  const selectedPaths = skillNames.map((name) => `/${name}/**`)

  if (selectedPaths.length > 0) {
    permissions.push({
      operations: ['read'],
      paths: selectedPaths,
    })
  }

  permissions.push({
    operations: ['read', 'write'],
    paths: ['/**'],
    mode: 'deny',
  })

  return permissions
}
