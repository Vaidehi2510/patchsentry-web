export function TeamAccessGuide() {
  return (
    <details>
      <summary>Which role should I choose?</summary>
      <p>
        <strong>Patchsentry roles are separate from GitHub permissions.</strong>{" "}
        Creating this project makes you its Patchsentry owner. It does not
        verify that you own its repository, grant GitHub access, or let
        Patchsentry read your secrets. A repository administrator must authorize
        the separate runner connection.
      </p>
      <p>
        For a company, appoint one accountable workspace owner—usually a
        repository administrator or the person delegated to manage QA. GitHub
        write access alone should not automatically make someone a workspace
        owner. People who can manage secrets should configure them on the
        trusted runner; Patchsentry does not need to read those secrets.
      </p>
      <div
        className="permission-matrix"
        role="region"
        aria-label="Project role permissions"
        tabIndex={0}
      >
        <table>
          <caption>Patchsentry project permissions</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Owner</th>
              <th scope="col">Admin</th>
              <th scope="col">QA engineer</th>
              <th scope="col">Viewer</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Read reports and tests", "Yes", "Yes", "Yes", "Yes"],
              ["Write tests and request QA", "Yes", "Yes", "Yes", "No"],
              ["Configure models, preview and Slack", "Yes", "Yes", "No", "No"],
              ["Invite QA engineers and viewers", "Yes", "Yes", "No", "No"],
              ["Appoint or remove admins", "Yes", "No", "No", "No"],
              ["Issue runner tokens / delete project", "Yes", "No", "No", "No"],
              [
                "MFA at every password login",
                "Required",
                "Required",
                "New/untrusted browser",
                "New/untrusted browser",
              ],
              [
                "Change product source through Patchsentry",
                "No",
                "No",
                "No",
                "No",
              ],
            ].map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th scope="row" key={i}>
                      {cell}
                    </th>
                  ) : (
                    <td key={i}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Roles apply per project. If you own or administer any project, the
        stricter MFA policy applies to your account across all projects. QA
        engineers and viewers can remember a browser for 30 days after MFA;
        password recovery, changed browser, revoked trust or promotion requires
        verification again.
      </p>
      <p>
        <a href="/architecture">Read the architecture and connection guide →</a>
      </p>
    </details>
  );
}
