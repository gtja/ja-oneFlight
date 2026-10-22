package com.oneflight.auth;

import com.oneflight.common.ApiException;
import com.oneflight.common.DeploymentOrigins;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Fixed deployment URLs only; neither fallback nor issuer comes from browser input. */
@Component
public class FourAProperties {
    public final String mode;
    public final boolean maintenanceLogin;
    public final String issuer;
    public final String parentOrigin;
    public final String transportMode;
    public final int timeoutSeconds;

    @Autowired public FourAProperties(
            @Value("${oneflight.auth.mode:local}") String mode,
            @Value("${oneflight.auth.local-maintenance-enabled:false}") boolean maintenanceLogin,
            @Value("${oneflight.auth.four-a-origin:https://4a.jing-an.com:32712}") String issuer,
            @Value("${oneflight.auth.parent-origin:}") String parentOrigin,
            @Value("${oneflight.auth.timeout-seconds:8}") int timeoutSeconds,
            @Value("${oneflight.transport-mode:https}") String transportMode) {
        if (!mode.equals("local") && !mode.equals("4a")) throw new IllegalArgumentException("认证模式必须是 local 或 4a");
        this.mode = mode;
        this.maintenanceLogin = maintenanceLogin;
        this.transportMode = DeploymentOrigins.transportMode(transportMode);
        this.issuer = DeploymentOrigins.identityOrigin(issuer);
        this.parentOrigin = DeploymentOrigins.publicOrigin(parentOrigin, this.transportMode);
        this.timeoutSeconds = Math.max(1, Math.min(timeoutSeconds, 30));
        if (isFourA() && this.parentOrigin.isEmpty()) throw new IllegalArgumentException("4A 模式需要固定的平台地址");
    }

    public FourAProperties(String mode, boolean maintenanceLogin, String issuer, String parentOrigin, int timeoutSeconds) {
        this(mode, maintenanceLogin, issuer, parentOrigin, timeoutSeconds, DeploymentOrigins.HTTPS);
    }

    public boolean isFourA() { return "4a".equals(mode); }
    public boolean localLoginEnabled() { return !isFourA() || maintenanceLogin; }
    public String callback() {
        if (parentOrigin.isEmpty()) throw ApiException.invalid("请配置固定的平台地址后验证 4A 身份");
        return parentOrigin + "/api/v1/auth/4a/callback";
    }
}
