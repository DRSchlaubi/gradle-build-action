import * as core from '@actions/core'
import * as exec from '@actions/exec'
import fs from 'fs'
import path from 'path'
import * as gradlew from './gradlew'


// https://regex101.com/r/3D3PYg/2
const JAVA_NOTICE_REGEX = new RegExp('Note: (?<path>.*(?=\\.java)\\.java) .*')
// https://regex101.com/r/tyYpzI/1
const JAVA_COMPILER_LOG_REGEX = new RegExp('(?<path>.*(?=:)):(?<line>\\d+): (?<level>error|warning):(?<message>.*)')
// https://regex101.com/r/XuRiOh/1
const KOTLIN_COMPILER_LOG_REGEX = new RegExp(
    '(?<level>e|w): (?<path>.*(?=:)): \\((?<line>\\d+), (?<position>\\d+)\\): (?<message>.*)'
)

export async function executeGradleBuild(executable: string | undefined, root: string, args: string[]): Promise<void> {
    let buildScanUrl: string | undefined

    const buildScanFile = path.resolve(root, 'gradle-build-scan.txt')
    if (fs.existsSync(buildScanFile)) {
        fs.unlinkSync(buildScanFile)
    }

    // Use the provided executable, or look for a Gradle wrapper script to run
    const toExecute = executable ?? gradlew.locateGradleWrapperScript(root)
    verifyIsExecutableScript(toExecute)
    const status: number = await exec.exec(toExecute, args, {
        cwd: root,
        ignoreReturnCode: true,
        listeners: {
            stdout: (data: Buffer) => logLines(data.toString(), false),
            stderr: (data: Buffer) => logLines(data.toString(), true)
        }
    })

    if (fs.existsSync(buildScanFile)) {
        buildScanUrl = fs.readFileSync(buildScanFile, 'utf-8')
    }

    if (status !== 0) {
        if (buildScanUrl) {
            core.setFailed(`Gradle build failed: ${buildScanUrl}`)
        } else {
            core.setFailed(`Gradle build failed: process exited with status ${status}`)
        }
    }
}

function logLines(lines: String, isError: boolean): void {
    // eslint-disable-next-line no-console
    console.log(`input: ${lines}`)
    const linesArray = lines.split(/[\s,]+/)
    for (const line of linesArray) {
        logLine(line, isError)
    }
}

// eslint-disable no-console
function logLine(line: string, isError: boolean): void {
    const javaCompilerMatch = JAVA_COMPILER_LOG_REGEX.exec(line)
    if (javaCompilerMatch != null) {
        doAnnotation(javaCompilerMatch)
    } else {
        const kotlinCompilerMatch = KOTLIN_COMPILER_LOG_REGEX.exec(line)
        if(kotlinCompilerMatch != null) {
            doAnnotation(kotlinCompilerMatch)
        } else {
            const javaNoticeMatch = JAVA_NOTICE_REGEX.exec(line)
            if(javaNoticeMatch != null) {
                doAnnotation(javaNoticeMatch, 'notice')
            } else {
                if(isError) {
                    core.error(line)
                } else {
                    // If it doesn't match any specific cases, we just print it to stdout, so it is displayed in the log
                    // eslint-disable-next-line no-console
                    //console.log(line)
                }
            }
        }
    }
}

function doAnnotation(match: RegExpExecArray, level: string | null = null): void {
    // All regexes have groups
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const groups = match.groups!

    const logLevel = level ?? groups['level']
    const filePath = groups['path']
    const message = groups['message'] ?? match.input
    const lineRaw = groups['line']
    const positionRaw = groups['position']
    const line = lineRaw != null ? parseInt(lineRaw) : null
    const position = positionRaw != null ? parseInt(positionRaw) : null

    const properties = <core.AnnotationProperties>{
        file: filePath,
        startLine: line,
        endLine: line,
        startColumn: position,
        endColoumn: position
    }

    switch(logLevel) {
        case 'e':
        case 'error':
            core.error(message, properties)
            break
        case 'w':
        case 'warning':
            core.warning(message, properties)
            break
        case 'notice':
            core.notice(message, properties)
            break
    }
}

function verifyIsExecutableScript(toExecute: string): void {
    try {
        fs.accessSync(toExecute, fs.constants.X_OK)
    } catch (err) {
        throw new Error(`Gradle script '${toExecute}' is not executable.`)
    }
}
