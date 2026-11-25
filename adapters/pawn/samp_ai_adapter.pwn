/*
 * SAMP.AI Pawn reference adapter.
 *
 * Requires the external https_samp transport plugin and json_parser include.
 * This sample intentionally implements only player-state reads and global
 * CreateObject operations in interior 0 / virtual world 0.
 */

#include <a_samp>

#define JSON_MAX_NODES 4096
#define JSON_MAX_VALUE_LEN 512
#define JSON_MAX_STRING_LEN 8192
#define JSON_SERIALIZE_BUFFER 8192
#include <json_parser>
#include <https_samp>

#define SAMP_AI_VERSION "0.1.0"
#define SAMP_AI_CONFIG_FILE "scriptfiles/samp_ai_adapter.json"
#define SAMP_AI_MAX_BODY 8192
#define SAMP_AI_MAX_CREATED_OBJECTS 400
#define SAMP_AI_POLL_MS 1500
#define SAMP_AI_HEARTBEAT_MS 15000
#define SAMP_AI_REQUEST_TIMEOUT_MS 10000

#define SAMP_AI_REQ_HELLO 101
#define SAMP_AI_REQ_POLL 102
#define SAMP_AI_REQ_HEARTBEAT 103
#define SAMP_AI_REQ_RESULT 104

new g_SampAiGateway[192];
new g_SampAiToken[256];
new g_SampAiServerId[128];
new g_SampAiAdapterId[80];
new g_SampAiRuntime[32];
new bool:g_SampAiClockIsUtc;

new bool:g_SampAiReady;
new bool:g_SampAiPollPending;
new bool:g_SampAiHeartbeatPending;
new bool:g_SampAiTaskPending;
new g_SampAiPollTimer = -1;
new g_SampAiHeartbeatTimer = -1;

new g_SampAiTaskId[64];
new g_SampAiLeaseToken[128];
new g_SampAiCreatedObjectCount;

forward SampAI_PollTimer();
forward SampAI_HeartbeatTimer();
forward SampAI_OnHttpResponse(index, response[], status, error);

public OnFilterScriptInit()
{
    JSON_Init();
    https_set_max_body_bytes(SAMP_AI_MAX_BODY);

    if (!SampAI_LoadConfig())
    {
        print("[SAMP.AI] Configuration failed. Adapter was not started.");
        return 0;
    }

    print("[SAMP.AI] Starting Pawn adapter handshake...");
    SampAI_SendHello();
    return 1;
}

public OnFilterScriptExit()
{
    if (g_SampAiPollTimer != -1) KillTimer(g_SampAiPollTimer);
    if (g_SampAiHeartbeatTimer != -1) KillTimer(g_SampAiHeartbeatTimer);

    // Do not destroy successfully-created world objects when the adapter unloads.
    // Their lifecycle is owned by the server; this sample has no durable object index.
    print("[SAMP.AI] Pawn adapter stopped. Review any in-flight task before restarting.");
    return 1;
}

stock bool:SampAI_LoadConfig()
{
    new documentId;
    if (!JSON_ParseFile(SAMP_AI_CONFIG_FILE, documentId))
    {
        printf("[SAMP.AI] Cannot parse %s. Copy the example config and edit it.", SAMP_AI_CONFIG_FILE);
        return false;
    }

    new root = JSON_GetRootNode(documentId);
    new bool:valid =
        JSON_GetStringByPath(root, "gateway_base_url", g_SampAiGateway, sizeof(g_SampAiGateway)) &&
        JSON_GetStringByPath(root, "adapter_token", g_SampAiToken, sizeof(g_SampAiToken)) &&
        JSON_GetStringByPath(root, "server_instance_id", g_SampAiServerId, sizeof(g_SampAiServerId)) &&
        JSON_GetStringByPath(root, "adapter_id", g_SampAiAdapterId, sizeof(g_SampAiAdapterId)) &&
        JSON_GetStringByPath(root, "runtime", g_SampAiRuntime, sizeof(g_SampAiRuntime)) &&
        JSON_GetBoolByPath(root, "server_clock_is_utc", g_SampAiClockIsUtc);

    JSON_DestroyDocument(documentId);

    if (!valid ||
        !g_SampAiClockIsUtc ||
        !strlen(g_SampAiToken) ||
        !strlen(g_SampAiServerId) ||
        !strlen(g_SampAiAdapterId))
    {
        print("[SAMP.AI] Config is missing a required value or server_clock_is_utc is not true.");
        return false;
    }

    // Never send adapter credentials over plaintext HTTP.
    if (strfind(g_SampAiGateway, "https://", true) != 0)
    {
        print("[SAMP.AI] gateway_base_url must use HTTPS.");
        return false;
    }

    new last = strlen(g_SampAiGateway) - 1;
    if (last >= 0 && g_SampAiGateway[last] == '/')
    {
        g_SampAiGateway[last] = EOS;
    }

    return true;
}

stock SampAI_BuildHello(body[], maxlen)
{
    new documentId, root = JSON_BuildObject(documentId);
    if (root == JSON_INVALID_NODE) return 0;

    new payload = JSON_CreateObject(documentId);
    new adapter = JSON_CreateObject(documentId);
    new capabilities = JSON_CreateArray(documentId);
    new limits = JSON_CreateObject(documentId);

    new messageId[64], timestamp[40];
    new year, month, day, hour, minute, second;
    getdate(year, month, day);
    gettime(hour, minute, second);
    format(messageId, sizeof(messageId), "pawn_hello_%d", GetTickCount());
    format(timestamp, sizeof(timestamp), "%04d-%02d-%02dT%02d:%02d:%02dZ",
        year, month, day, hour, minute, second);

    JSON_ObjectSetString(root, "protocol", "sampai/0.1");
    JSON_ObjectSetString(root, "message_id", messageId);
    JSON_ObjectSetString(root, "type", "event");
    JSON_ObjectSetString(root, "server_instance_id", g_SampAiServerId);
    JSON_ObjectSetString(root, "timestamp", timestamp);
    JSON_ObjectSetString(root, "event", "adapter.hello");

    JSON_ObjectSetString(adapter, "name", g_SampAiAdapterId);
    JSON_ObjectSetString(adapter, "version", SAMP_AI_VERSION);
    JSON_ObjectSetString(adapter, "runtime", g_SampAiRuntime);

    // Advertise only actions that this reference script actually dispatches.
    JSON_ArrayAppendString(capabilities, "context.player_state");
    JSON_ArrayAppendString(capabilities, "mapping.create_object");

    JSON_ObjectSetInt(limits, "max_operations_per_batch", 1);
    JSON_ObjectSetInt(limits, "max_objects_per_project", SAMP_AI_MAX_CREATED_OBJECTS);

    JSON_ObjectSetValue(payload, "adapter", adapter);
    JSON_ObjectSetValue(payload, "capabilities", capabilities);
    JSON_ObjectSetValue(payload, "limits", limits);
    JSON_ObjectSetValue(root, "payload", payload);

    new bool:serialized = JSON_Serialize(root, body, maxlen, false);
    JSON_DestroyDocument(documentId);
    return serialized;
}

stock bool:SampAI_PostJson(index, const path[], const body[], const callback[])
{
    new url[320];
    format(url, sizeof(url), "%s%s", g_SampAiGateway, path);

    if (!https_set_bearer_once(g_SampAiToken) ||
        !https_set_timeout_once(SAMP_AI_REQUEST_TIMEOUT_MS) ||
        !https_jsonf(body))
    {
        print("[SAMP.AI] Could not prepare authenticated JSON request.");
        return false;
    }

    return https(index, HTTPS_POST, url, "", callback) != 0;
}

stock bool:SampAI_Get(index, const path[], const callback[])
{
    new url[320];
    format(url, sizeof(url), "%s%s", g_SampAiGateway, path);

    if (!https_set_bearer_once(g_SampAiToken) ||
        !https_set_timeout_once(SAMP_AI_REQUEST_TIMEOUT_MS))
    {
        print("[SAMP.AI] Could not prepare authenticated GET request.");
        return false;
    }

    return https(index, HTTPS_GET, url, "", callback) != 0;
}

stock SampAI_SendHello()
{
    new body[SAMP_AI_MAX_BODY];
    if (!SampAI_BuildHello(body, sizeof(body)))
    {
        print("[SAMP.AI] Could not serialize adapter hello.");
        return 0;
    }

    if (!SampAI_PostJson(
        SAMP_AI_REQ_HELLO,
        "/v1/adapters/hello",
        body,
        "SampAI_OnHttpResponse"
    ))
    {
        print("[SAMP.AI] Could not send adapter hello.");
        return 0;
    }
    return 1;
}

public SampAI_PollTimer()
{
    if (!g_SampAiReady || g_SampAiPollPending || g_SampAiTaskPending) return 1;

    g_SampAiPollPending = true;
    if (!SampAI_Get(
        SAMP_AI_REQ_POLL,
        "/v1/adapters/tasks/next",
        "SampAI_OnHttpResponse"
    ))
    {
        g_SampAiPollPending = false;
    }
    return 1;
}

public SampAI_HeartbeatTimer()
{
    if (!g_SampAiReady || g_SampAiHeartbeatPending) return 1;

    g_SampAiHeartbeatPending = true;
    new url[320];
    format(url, sizeof(url), "%s/v1/adapters/heartbeat", g_SampAiGateway);

    if (!https_set_bearer_once(g_SampAiToken) ||
        !https_set_timeout_once(SAMP_AI_REQUEST_TIMEOUT_MS) ||
        !https(SAMP_AI_REQ_HEARTBEAT, HTTPS_POST, url, "", "SampAI_OnHttpResponse"))
    {
        g_SampAiHeartbeatPending = false;
    }
    return 1;
}

public SampAI_OnHttpResponse(index, response[], status, error)
{
    if (index == SAMP_AI_REQ_HELLO)
    {
        if (error != HTTPS_ERROR_NONE || status != 201)
        {
            printf("[SAMP.AI] Hello failed. status=%d transport_error=%d", status, error);
            return 1;
        }

        g_SampAiReady = true;
        g_SampAiPollTimer = SetTimer("SampAI_PollTimer", SAMP_AI_POLL_MS, true);
        g_SampAiHeartbeatTimer = SetTimer("SampAI_HeartbeatTimer", SAMP_AI_HEARTBEAT_MS, true);
        print("[SAMP.AI] Adapter authenticated and registered.");
        SampAI_PollTimer();
        return 1;
    }

    if (index == SAMP_AI_REQ_POLL)
    {
        g_SampAiPollPending = false;

        if (error != HTTPS_ERROR_NONE)
        {
            printf("[SAMP.AI] Task poll transport error: %d", error);
            return 1;
        }

        if (status == 204) return 1;
        if (status != 200)
        {
            printf("[SAMP.AI] Task poll rejected. HTTP status=%d", status);
            if (status == 401 || status == 403) g_SampAiReady = false;
            return 1;
        }

        // Pause polling until this claimed task has a confirmed result.
        // A malformed response must not make the adapter claim a second task.
        g_SampAiTaskPending = true;
        SampAI_HandleTask(response);
        return 1;
    }

    if (index == SAMP_AI_REQ_HEARTBEAT)
    {
        g_SampAiHeartbeatPending = false;
        if (error != HTTPS_ERROR_NONE || status != 200)
        {
            printf("[SAMP.AI] Heartbeat failed. status=%d transport_error=%d", status, error);
            if (status == 401 || status == 403) g_SampAiReady = false;
        }
        return 1;
    }

    if (index == SAMP_AI_REQ_RESULT)
    {
        if (error == HTTPS_ERROR_NONE && status == 200)
        {
            printf("[SAMP.AI] Task %s completed.", g_SampAiTaskId);
            g_SampAiTaskPending = false;
            g_SampAiTaskId[0] = EOS;
            g_SampAiLeaseToken[0] = EOS;
        }
        else
        {
            // Fail closed: do not claim another task while this result is uncertain.
            printf("[SAMP.AI] Result submission uncertain for task %s. status=%d transport_error=%d",
                g_SampAiTaskId, status, error);
        }
        return 1;
    }

    return 1;
}

stock SampAI_HandleTask(const response[])
{
    new taskDocument;
    if (!JSON_Parse(response, taskDocument))
    {
        print("[SAMP.AI] Could not parse task response; no action was executed.");
        return 0;
    }

    new root = JSON_GetRootNode(taskDocument);
    new actionId[80], payloadNode;
    new bool:valid =
        JSON_GetStringByPath(root, "task.taskId", g_SampAiTaskId, sizeof(g_SampAiTaskId)) &&
        JSON_GetStringByPath(root, "task.leaseToken", g_SampAiLeaseToken, sizeof(g_SampAiLeaseToken)) &&
        JSON_GetStringByPath(root, "task.actionId", actionId, sizeof(actionId));

    payloadNode = JSON_GetByPath(root, "task.payload");
    if (!valid || payloadNode == JSON_INVALID_NODE)
    {
        JSON_DestroyDocument(taskDocument);
        print("[SAMP.AI] Task envelope is incomplete; no action was executed.");
        return 0;
    }

    g_SampAiTaskPending = true;

    new resultDocument, resultRoot = JSON_BuildObject(resultDocument);
    new resultNode = JSON_CreateObject(resultDocument);
    new outputNode = JSON_CreateObject(resultDocument);
    new errorCode[80], errorMessage[256];

    new bool:succeeded = SampAI_ExecuteTask(
        actionId,
        payloadNode,
        resultDocument,
        outputNode,
        errorCode,
        sizeof(errorCode),
        errorMessage,
        sizeof(errorMessage)
    );

    JSON_ObjectSetString(resultRoot, "lease_token", g_SampAiLeaseToken);
    if (succeeded)
    {
        JSON_ObjectSetString(resultNode, "status", "succeeded");
    }
    else
    {
        JSON_ObjectSetString(resultNode, "status", "failed");
    }

    if (succeeded)
    {
        JSON_ObjectSetValue(resultNode, "output", outputNode);
    }
    else
    {
        new errorNode = JSON_CreateObject(resultDocument);
        JSON_ObjectSetString(errorNode, "code", errorCode);
        JSON_ObjectSetString(errorNode, "message", errorMessage);
        JSON_ObjectSetValue(resultNode, "error", errorNode);
    }

    JSON_ObjectSetValue(resultRoot, "result", resultNode);

    new body[SAMP_AI_MAX_BODY];
    new bool:serialized = JSON_Serialize(resultRoot, body, sizeof(body), false);

    JSON_DestroyDocument(resultDocument);
    JSON_DestroyDocument(taskDocument);

    if (!serialized)
    {
        print("[SAMP.AI] Could not serialize task result. Adapter is paused for manual inspection.");
        return 0;
    }

    new path[160];
    format(path, sizeof(path), "/v1/adapters/tasks/%s/result", g_SampAiTaskId);

    if (!SampAI_PostJson(
        SAMP_AI_REQ_RESULT,
        path,
        body,
        "SampAI_OnHttpResponse"
    ))
    {
        print("[SAMP.AI] Could not submit task result. Adapter is paused for manual inspection.");
        return 0;
    }

    return 1;
}

stock bool:SampAI_ExecuteTask(
    const actionId[],
    payloadNode,
    documentId,
    outputNode,
    errorCode[],
    errorCodeSize,
    errorMessage[],
    errorMessageSize
)
{
    if (!strcmp(actionId, "context.get_player_state", true))
    {
        new playerId;
        if (!JSON_GetIntByPath(payloadNode, "player_id", playerId) ||
            playerId < 0 || playerId >= MAX_PLAYERS)
        {
            format(errorCode, errorCodeSize, "PLAYER_ID_INVALID");
            format(errorMessage, errorMessageSize, "player_id is outside the supported player range.");
            return false;
        }

        JSON_ObjectSetInt(outputNode, "player_id", playerId);
        if (!IsPlayerConnected(playerId))
        {
            JSON_ObjectSetBool(outputNode, "found", false);
            return true;
        }

        new Float:x, Float:y, Float:z, Float:facing;
        GetPlayerPos(playerId, x, y, z);
        GetPlayerFacingAngle(playerId, facing);

        JSON_ObjectSetBool(outputNode, "found", true);
        SampAI_AddVector(documentId, outputNode, "position", x, y, z);
        JSON_ObjectSetFloat(outputNode, "facing", facing);
        JSON_ObjectSetInt(outputNode, "interior_id", GetPlayerInterior(playerId));
        JSON_ObjectSetInt(outputNode, "virtual_world_id", GetPlayerVirtualWorld(playerId));
        return true;
    }

    if (!strcmp(actionId, "mapping.create_object", true))
    {
        new operationId[129], objectId[101], projectId[101];
        new modelId, interiorId, virtualWorldId;
        new Float:x, Float:y, Float:z, Float:rx, Float:ry, Float:rz;

        if (!JSON_GetStringByPath(payloadNode, "operation_id", operationId, sizeof(operationId)) ||
            !JSON_GetStringByPath(payloadNode, "object_id", objectId, sizeof(objectId)) ||
            !JSON_GetStringByPath(payloadNode, "project_id", projectId, sizeof(projectId)) ||
            !JSON_GetIntByPath(payloadNode, "model_id", modelId) ||
            !JSON_GetIntByPath(payloadNode, "interior_id", interiorId) ||
            !JSON_GetIntByPath(payloadNode, "virtual_world_id", virtualWorldId) ||
            !SampAI_ReadVector(payloadNode, "position", x, y, z) ||
            !SampAI_ReadVector(payloadNode, "rotation", rx, ry, rz))
        {
            format(errorCode, errorCodeSize, "MAPPING_PAYLOAD_INVALID");
            format(errorMessage, errorMessageSize, "The mapping.create_object payload is incomplete.");
            return false;
        }

        if (!strlen(operationId) || !strlen(objectId) || !strlen(projectId) ||
            modelId < 1 || modelId > 65535)
        {
            format(errorCode, errorCodeSize, "MAPPING_VALUE_INVALID");
            format(errorMessage, errorMessageSize, "Object identity or model_id is outside the supported range.");
            return false;
        }

        // The legacy global CreateObject native has no interior assignment parameter.
        if (interiorId != 0 || virtualWorldId != 0)
        {
            format(errorCode, errorCodeSize, "MAPPING_CONTEXT_UNSUPPORTED");
            format(errorMessage, errorMessageSize,
                "This Pawn reference adapter only creates global objects in interior 0 and virtual world 0.");
            return false;
        }

        if (g_SampAiCreatedObjectCount >= SAMP_AI_MAX_CREATED_OBJECTS)
        {
            format(errorCode, errorCodeSize, "MAPPING_OBJECT_LIMIT");
            format(errorMessage, errorMessageSize, "The Pawn adapter reached its configured object limit.");
            return false;
        }

        new nativeObjectId = CreateObject(modelId, x, y, z, rx, ry, rz);
        if (nativeObjectId == INVALID_OBJECT_ID)
        {
            format(errorCode, errorCodeSize, "GAME_OBJECT_CREATE_FAILED");
            format(errorMessage, errorMessageSize, "CreateObject failed; the server object pool may be full.");
            return false;
        }

        g_SampAiCreatedObjectCount++;

        JSON_ObjectSetString(outputNode, "object_id", objectId);
        JSON_ObjectSetString(outputNode, "project_id", projectId);
        JSON_ObjectSetInt(outputNode, "model_id", modelId);
        SampAI_AddVector(documentId, outputNode, "position", x, y, z);
        SampAI_AddVector(documentId, outputNode, "rotation", rx, ry, rz);
        // CreateObject is global; do not claim the native scoped it.
        JSON_ObjectSetString(outputNode, "scope", "global");
        JSON_ObjectSetInt(outputNode, "requested_interior_id", interiorId);
        JSON_ObjectSetInt(outputNode, "requested_virtual_world_id", virtualWorldId);
        JSON_ObjectSetInt(outputNode, "runtime_object_id", nativeObjectId);
        return true;
    }

    format(errorCode, errorCodeSize, "ACTION_UNSUPPORTED");
    format(errorMessage, errorMessageSize, "This Pawn adapter does not implement the requested action.");
    return false;
}

stock bool:SampAI_ReadVector(rootNode, const prefix[], &Float:x, &Float:y, &Float:z)
{
    new path[64], node;

    format(path, sizeof(path), "%s.x", prefix);
    node = JSON_GetByPath(rootNode, path);
    if (node == JSON_INVALID_NODE || !JSON_GetFloat(node, x)) return false;

    format(path, sizeof(path), "%s.y", prefix);
    node = JSON_GetByPath(rootNode, path);
    if (node == JSON_INVALID_NODE || !JSON_GetFloat(node, y)) return false;

    format(path, sizeof(path), "%s.z", prefix);
    node = JSON_GetByPath(rootNode, path);
    if (node == JSON_INVALID_NODE || !JSON_GetFloat(node, z)) return false;

    if (x < -100000.0 || x > 100000.0 ||
        y < -100000.0 || y > 100000.0 ||
        z < -100000.0 || z > 100000.0)
    {
        return false;
    }
    return true;
}

stock SampAI_AddVector(documentId, parentNode, const key[], Float:x, Float:y, Float:z)
{
    new vectorNode = JSON_CreateObject(documentId);
    JSON_ObjectSetFloat(vectorNode, "x", x);
    JSON_ObjectSetFloat(vectorNode, "y", y);
    JSON_ObjectSetFloat(vectorNode, "z", z);
    JSON_ObjectSetValue(parentNode, key, vectorNode);
    return 1;
}
