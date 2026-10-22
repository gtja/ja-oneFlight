package com.oneflight.auth;

import com.oneflight.domain.*;
import com.oneflight.repository.*;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
public class AdminBootstrap {
    @Bean
    ApplicationRunner initializeAdmin(
            UserAccountRepository users,
            OrganizationRepository organizations,
            PasswordEncoder encoder,
            TransactionTemplate tx,
            FourAProperties fourA,
            @Value("${oneflight.bootstrap.username:admin}") String username,
            @Value("${oneflight.bootstrap.password:}") String password,
            @Value("${oneflight.bootstrap.display-name:平台管理员}") String displayName) {
        return args -> {
            if (fourA.isFourA() || password.isBlank() || users.count() > 0) return;
            if (password.length() < 12) throw new IllegalStateException("首次管理员密码至少12位");
            tx.executeWithoutResult(
                    status -> {
                        Organization org = new Organization();
                        org.title = "平台运营中心";
                        org.status = "ACTIVE";
                        org.region = "杭州市";
                        org.organizationId = org.id;
                        organizations.save(org);
                        UserAccount admin = new UserAccount();
                        admin.username = username;
                        admin.passwordHash = encoder.encode(password);
                        admin.displayName = displayName;
                        admin.role = Role.ADMIN;
                        admin.organizationId = org.id;
                        users.save(admin);
                    });
        };
    }
}
