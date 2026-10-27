package com.oneflight.integration;

import com.oneflight.auth.AccessScope;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.common.ApiResponse;
import com.oneflight.common.PageResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.*;
import static com.oneflight.integration.SourceModels.*;

@RestController
@RequestMapping("/api/v1")
public class IntegrationController {
    private final DeviceDirectory directory;
    private final TelemetryReceiver telemetry;
    private final SourceDatabase database;
    private final AlgorithmCatalog algorithms;
    private final FlightCommandGateway commands;
    private final SourceExtensions extensions;
    private final AccessScope scope;
    public IntegrationController(DeviceDirectory directory, TelemetryReceiver telemetry, SourceDatabase database,
            AlgorithmCatalog algorithms, FlightCommandGateway commands, SourceExtensions extensions, AccessScope scope) {
        this.directory = directory; this.telemetry = telemetry; this.database = database;
        this.algorithms = algorithms; this.commands = commands; this.extensions = extensions; this.scope = scope;
    }
    @GetMapping("/devices")
    public ApiResponse<PageResult<Device>> devices(@RequestParam(required=false) String keyword,
            @RequestParam(required=false) String type, @RequestParam(required=false) Boolean hasFlightTotals,
            @RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize) {
        pagination(page, pageSize); return ApiResponse.ok(directory.list(keyword, type, hasFlightTotals, page, pageSize, telemetry, database));
    }
    @GetMapping("/devices/{id}")
    public ApiResponse<Device> device(@PathVariable String id) { return ApiResponse.ok(directory.detail(id, telemetry, database)); }
    @GetMapping("/devices/{id}/telemetry")
    public ApiResponse<Telemetry> telemetry(@PathVariable String id) {
        directory.require(id); return ApiResponse.ok(telemetry.current(id));
    }
    @GetMapping("/weather/observations")
    public ApiResponse<WeatherOverview> weatherObservations() {
        return ApiResponse.ok(new WeatherOverview(telemetry.health(), directory.weatherObservations(telemetry)));
    }
    @GetMapping("/devices/{id}/capabilities")
    public ApiResponse<Capabilities> capabilities(@PathVariable String id) {
        directory.require(id);
        return ApiResponse.ok(new Capabilities(id, Map.of("telemetry", telemetry.health().state() != SourceState.UNCONFIGURED, "dispatchTask", false,
                "takeoff", false, "returnHome", false, "trajectory", false, "liveVideo", false,
                "detections", false), "任务办理进度与真实飞行控制分别管理；真实控制尚未接入"));
    }
    @PostMapping("/devices/{id}/commands")
    public ApiResponse<Void> command(@PathVariable String id, @Valid @RequestBody CommandRequest request) {
        requireOperator(); directory.require(id); commands.execute(id, request.command()); return ApiResponse.ok(null);
    }
    @GetMapping("/flights")
    public ApiResponse<PageResult<Flight>> flights(@RequestParam(required=false) String deviceId,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize) {
        pagination(page, pageSize);
        Set<String> before = directory.allowedIds();
        PageResult<Flight> data = database.flights(before, deviceId, page, pageSize);
        verifyScope(before); return ApiResponse.ok(data);
    }
    @GetMapping("/executions")
    public ApiResponse<PageResult<Execution>> executions(@RequestParam(required=false) String deviceId,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize) {
        pagination(page, pageSize);
        Set<String> before = directory.allowedIds();
        PageResult<Execution> data = database.executions(before, deviceId, page, pageSize);
        verifyScope(before); return ApiResponse.ok(data);
    }
    @GetMapping("/algorithms")
    public ApiResponse<PageResult<Algorithm>> algorithms(@RequestParam(required=false) String keyword,
            @RequestParam(required=false) String category, @RequestParam(required=false) String deviceType,
            @RequestParam(defaultValue="all") String deployment, @RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize) {
        pagination(page, pageSize); return ApiResponse.ok(algorithms.list(keyword, category, deviceType, deployment, page, pageSize));
    }
    @GetMapping("/algorithms/statistics")
    public ApiResponse<AlgorithmStatistics> statistics(@RequestParam(required=false) String keyword,
            @RequestParam(required=false) String category, @RequestParam(required=false) String deviceType) {
        return ApiResponse.ok(algorithms.statistics(keyword, category, deviceType));
    }
    @GetMapping("/algorithms/categories")
    public ApiResponse<List<AlgorithmCategory>> categories(@RequestParam(required=false) String deviceType) {
        return ApiResponse.ok(algorithms.categories(deviceType));
    }
    @GetMapping("/algorithms/{id}/devices")
    public ApiResponse<PageResult<AlgorithmDeployment>> deployedDevices(@PathVariable String id,
            @RequestParam(defaultValue="1") int page, @RequestParam(defaultValue="20") int pageSize) {
        pagination(page, pageSize); return ApiResponse.ok(algorithms.deployments(id, page, pageSize));
    }
    @GetMapping("/flights/{id}/trajectory")
    public ApiResponse<?> flightTrajectory(@PathVariable String id) {
        Set<String> allowed = directory.allowedIds(); database.requireFlight(id, allowed); verifyScope(allowed);
        return ApiResponse.ok(extensions.trajectory(id));
    }
    @GetMapping("/flights/{id}/media")
    public ApiResponse<?> flightMedia(@PathVariable String id) {
        Set<String> allowed = directory.allowedIds(); String deviceId = database.requireFlight(id, allowed); verifyScope(allowed);
        return ApiResponse.ok(extensions.media(deviceId));
    }
    @GetMapping("/devices/{id}/trajectory")
    public ApiResponse<?> trajectory(@PathVariable String id) { directory.require(id); return ApiResponse.ok(extensions.trajectory(id)); }
    @GetMapping("/devices/{id}/media")
    public ApiResponse<?> media(@PathVariable String id) { directory.require(id); return ApiResponse.ok(extensions.media(id)); }
    @GetMapping("/devices/{id}/detections")
    public ApiResponse<?> detections(@PathVariable String id) { directory.require(id); return ApiResponse.ok(extensions.detections(id)); }
    @GetMapping("/algorithms/{id}/training")
    public ApiResponse<?> training(@PathVariable String id) { requireOperator(); return ApiResponse.ok(extensions.training(id)); }
    @PostMapping("/algorithms/{id}/train")
    public ApiResponse<Void> train(@PathVariable String id) { requireOperator(); extensions.train(id); return ApiResponse.ok(null); }
    @PostMapping("/algorithms/{id}/deploy")
    public ApiResponse<Void> deploy(@PathVariable String id, @RequestBody DeploymentRequest request) {
        requireOperator(); directory.require(request.deviceId()); extensions.deploy(id, request.deviceId()); return ApiResponse.ok(null);
    }
    @GetMapping("/integrations/status")
    public ApiResponse<List<SourceHealth>> status() { requireAdmin(); return ApiResponse.ok(health()); }
    @PostMapping("/integrations/refresh")
    public ApiResponse<List<SourceHealth>> refresh() {
        requireAdmin(); directory.refresh(); database.probe(); telemetry.synchronizeSubscriptions(); return ApiResponse.ok(health());
    }
    private List<SourceHealth> health() {
        List<SourceHealth> result = new ArrayList<>(); result.add(directory.health()); result.addAll(database.health());
        result.add(telemetry.health()); result.add(algorithms.health()); return result;
    }
    private void verifyScope(Set<String> before) { if (!directory.allowedIds().containsAll(before)) { throw ProviderJson.failure("设备授权已变化，请重新查询"); } }
    private void requireAdmin() { if (scope.currentUser().role() != Role.ADMIN) { throw ApiException.forbidden(); } }
    private void requireOperator() {
        Role role = scope.currentUser().role(); if (role != Role.ADMIN && role != Role.DISPATCH) { throw ApiException.forbidden(); }
    }
    private static void pagination(int page, int size) { if (page < 1 || page > 100_000 || size < 1 || size > 100) { throw ApiException.invalid("分页范围无效"); } }
    public record CommandRequest(@NotNull FlightCommandGateway.Command command) { }
    public record DeploymentRequest(@NotNull String deviceId) { }
}
