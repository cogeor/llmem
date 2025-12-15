/**
 * Extract file information from artifacts
 */

import { FileArtifact, Entity } from '../parser/types';
import { deriveEntityId } from '../graph/utils';
import { FileInfo, FunctionInfo, ClassInfo, ReverseCallIndex } from './types';
import { getCallersForEntity } from './reverse-index';

/**
 * Check if an entity is a function-like (callable)
 */
function isFunctionLike(kind: string): boolean {
    return ['function', 'method', 'arrow', 'ctor', 'getter', 'setter'].includes(kind);
}

/**
 * Check if an entity is a class
 */
function isClass(kind: string): boolean {
    return kind === 'class';
}

/**
 * Extract function info from an entity
 */
function extractFunctionInfo(
    entity: Entity,
    fileId: string,
    reverseIndex: ReverseCallIndex
): FunctionInfo {
    const entityId = deriveEntityId(fileId, entity.id);
    const callers = getCallersForEntity(entityId, reverseIndex);

    return {
        name: entity.name,
        signature: entity.signature || entity.name,
        kind: entity.kind,
        calledBy: callers,
        isExported: entity.isExported
    };
}

/**
 * Extract class info from entities
 * Groups methods with their parent class
 */
function extractClassInfo(
    classEntity: Entity,
    allEntities: Entity[],
    fileId: string,
    reverseIndex: ReverseCallIndex
): ClassInfo {
    // Find methods belonging to this class
    // Methods typically have the class name in their id or are defined within class loc range
    const methods: FunctionInfo[] = [];

    for (const entity of allEntities) {
        if (!isFunctionLike(entity.kind)) continue;

        // Check if method is within class line range
        const inClassRange =
            entity.loc.startLine >= classEntity.loc.startLine &&
            entity.loc.endLine <= classEntity.loc.endLine;

        // Check if it's a method (not the class itself)
        if (inClassRange && entity.id !== classEntity.id) {
            methods.push(extractFunctionInfo(entity, fileId, reverseIndex));
        }
    }

    return {
        name: classEntity.name,
        signature: classEntity.signature || classEntity.name,
        methods,
        isExported: classEntity.isExported
    };
}

/**
 * Extract complete file info from an artifact
 * 
 * @param fileId The file identifier (relative path)
 * @param artifact The parsed file artifact
 * @param reverseIndex The reverse call index
 * @returns FileInfo object with functions and classes
 */
export function extractFileInfo(
    fileId: string,
    artifact: FileArtifact,
    reverseIndex: ReverseCallIndex
): FileInfo {
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];
    const processedEntityIds = new Set<string>();

    // First pass: find classes and their methods
    for (const entity of artifact.entities) {
        if (isClass(entity.kind)) {
            const classInfo = extractClassInfo(entity, artifact.entities, fileId, reverseIndex);
            classes.push(classInfo);

            // Mark all methods as processed
            processedEntityIds.add(entity.id);
            for (const method of classInfo.methods) {
                // Find the entity by name to get its id
                const methodEntity = artifact.entities.find(e => e.name === method.name && isFunctionLike(e.kind));
                if (methodEntity) {
                    processedEntityIds.add(methodEntity.id);
                }
            }
        }
    }

    // Second pass: find standalone functions (not in classes)
    for (const entity of artifact.entities) {
        if (isFunctionLike(entity.kind) && !processedEntityIds.has(entity.id)) {
            functions.push(extractFunctionInfo(entity, fileId, reverseIndex));
        }
    }

    return {
        filePath: fileId,
        functions,
        classes
    };
}
