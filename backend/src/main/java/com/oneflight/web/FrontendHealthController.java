package com.oneflight.web;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Keeps the existing web liveness URL; container readiness uses /actuator/health. */
@RestController
public class FrontendHealthController {
    @GetMapping(value = "/healthz", produces = MediaType.TEXT_PLAIN_VALUE)
    public String health() {
        return "ok";
    }
}
