package com.oneflight;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FrontendHostingIntegrationTest {
    @Autowired MockMvc mvc;

    @Test
    void anonymousBrowserCanReadHtmlAndHashedAssetsWithDistinctCachePolicies() throws Exception {
        mvc.perform(get("/index.html"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
                .andExpect(content().string(containsString("frontend-hosting-test")))
                .andExpect(header().string("Cache-Control", "no-cache"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Referrer-Policy", "strict-origin-when-cross-origin"));
        mvc.perform(get("/?view=resources"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("index.html"));
        mvc.perform(get("/assets/hosting-test-a1b2c3.js"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("frontendAssetLoaded")))
                .andExpect(header().string("Cache-Control", containsString("max-age=31536000")))
                .andExpect(header().string("Cache-Control", containsString("public")))
                .andExpect(header().string("Cache-Control", containsString("immutable")));
        mvc.perform(head("/assets/hosting-test-a1b2c3.js"))
                .andExpect(status().isOk())
                .andExpect(content().string(""));
        mvc.perform(get("/logo.svg"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-cache"));
        mvc.perform(get("/healthz"))
                .andExpect(status().isOk())
                .andExpect(content().string("ok"));
    }

    @Test
    void staticWhitelistCannotExposeApiOrTurnMissingResourcesIntoHtml() throws Exception {
        mvc.perform(get("/api/v1/tasks"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(get("/assets/missing.js"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/v1/missing").with(user("hosting-check")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/unregistered-page"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void csrfRemainsRequiredForLoginAndWritesEvenThoughTheHtmlIsPublic() throws Exception {
        mvc.perform(get("/api/v1/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.headerName").value("X-CSRF-TOKEN"));
        mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"hosting-missing-user\",\"password\":\"test-only-invalid-password\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"hosting-missing-user\",\"password\":\"test-only-invalid-password\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        mvc.perform(post("/assets/hosting-test-a1b2c3.js").with(user("hosting-check")))
                .andExpect(status().isForbidden());
        mvc.perform(post("/assets/hosting-test-a1b2c3.js").with(csrf()))
                .andExpect(status().isUnauthorized());
    }
}
